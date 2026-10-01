//! Transporte HID real (hidapi) para o AK820 Pro.

use ak820_core::ops::Transport;
use ak820_core::packets::Packet;
use ak820_core::{
    IFACE_CONTROL, IFACE_DATA, PID_BOOTLOADER, PID_DONGLE, PID_WIRED, USAGE_PAGE_CONTROL,
    USAGE_PAGE_DATA, VID,
};
use hidapi::{DeviceInfo, HidApi, HidDevice};
use serde::Serialize;
use std::ffi::CString;
use std::thread;
use std::time::Duration;

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DeviceStatus {
    /// "connected" | "wireless" | "bootloader" | "partial" | "disconnected" | "error"
    pub state: String,
    pub product: Option<String>,
    pub message: String,
}

impl DeviceStatus {
    fn new(state: &str, product: Option<String>, message: impl Into<String>) -> Self {
        Self { state: state.into(), product, message: message.into() }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InterfaceInfo {
    pub vid: String,
    pub pid: String,
    pub interface: i32,
    pub usage_page: String,
    pub usage: String,
    pub product: String,
    pub role: String,
    pub path: String,
}

struct Endpoints {
    control: CString,
    data: Option<CString>,
    product: Option<String>,
}

fn is_ours(d: &DeviceInfo) -> bool {
    d.vendor_id() == VID
}

fn find_endpoints(api: &HidApi) -> Option<Endpoints> {
    let wired: Vec<&DeviceInfo> = api
        .device_list()
        .filter(|d| is_ours(d) && d.product_id() == PID_WIRED)
        .collect();
    if wired.is_empty() {
        return None;
    }
    let pick = |page: u16, iface: i32| -> Option<CString> {
        wired
            .iter()
            .find(|d| d.usage_page() == page)
            .or_else(|| wired.iter().find(|d| d.interface_number() == iface && d.usage_page() >= 0xFF00))
            .map(|d| d.path().to_owned())
    };
    let control = pick(USAGE_PAGE_CONTROL, IFACE_CONTROL)?;
    let data = pick(USAGE_PAGE_DATA, IFACE_DATA);
    let product = wired.iter().find_map(|d| d.product_string().map(str::to_owned));
    Some(Endpoints { control, data, product })
}

pub fn status(api: &HidApi) -> DeviceStatus {
    if let Some(ep) = find_endpoints(api) {
        return if ep.data.is_some() {
            DeviceStatus::new("connected", ep.product, "Conectado pelo cabo USB")
        } else {
            DeviceStatus::new(
                "partial",
                ep.product,
                "Interface de imagem não encontrada — RGB e relógio funcionam, envio de imagem não",
            )
        };
    }
    let ours: Vec<&DeviceInfo> = api.device_list().filter(|d| is_ours(d)).collect();
    if ours.iter().any(|d| d.product_id() == PID_BOOTLOADER) {
        return DeviceStatus::new("bootloader", None, "Teclado em modo bootloader");
    }
    if ours.iter().any(|d| d.product_id() == PID_DONGLE) {
        return DeviceStatus::new(
            "wireless",
            None,
            "Teclado no receptor 2.4G — use o cabo USB e a chave no modo com fio",
        );
    }
    if ours.iter().any(|d| d.product_id() == PID_WIRED) {
        return DeviceStatus::new(
            "partial",
            None,
            "Teclado encontrado, mas sem interface de configuração (feche o software oficial)",
        );
    }
    DeviceStatus::new("disconnected", None, "Conecte o AK820 Pro pelo cabo USB")
}

pub fn diagnostics(api: &HidApi) -> Vec<InterfaceInfo> {
    api.device_list()
        .filter(|d| is_ours(d))
        .map(|d| {
            let role = match (d.product_id(), d.usage_page()) {
                (PID_WIRED, USAGE_PAGE_CONTROL) => "controle",
                (PID_WIRED, USAGE_PAGE_DATA) => "dados (tela)",
                (PID_DONGLE, _) => "receptor 2.4G",
                (PID_BOOTLOADER, _) => "bootloader",
                _ => "",
            };
            InterfaceInfo {
                vid: format!("{:04X}", d.vendor_id()),
                pid: format!("{:04X}", d.product_id()),
                interface: d.interface_number(),
                usage_page: format!("{:04X}", d.usage_page()),
                usage: format!("{:04X}", d.usage()),
                product: d.product_string().unwrap_or("").to_owned(),
                role: role.into(),
                path: d.path().to_string_lossy().into_owned(),
            }
        })
        .collect()
}

pub struct HidTransport {
    control: HidDevice,
    data: Option<HidDevice>,
    buf: Vec<u8>,
}

impl HidTransport {
    pub fn open(api: &HidApi, need_data: bool) -> Result<Self, String> {
        let ep = find_endpoints(api).ok_or_else(|| status(api).message)?;
        let control = api
            .open_path(&ep.control)
            .map_err(|e| format!("não foi possível abrir a interface de controle: {e}. Feche o software oficial da AJAZZ e tente de novo."))?;
        let data = match (&ep.data, need_data) {
            (Some(p), true) => Some(api.open_path(p).map_err(|e| {
                format!("não foi possível abrir a interface de imagem: {e}. Feche o software oficial da AJAZZ e tente de novo.")
            })?),
            (None, true) => {
                return Err("a interface de imagem (0xFF68) não apareceu. Use o cabo USB no modo com fio.".into())
            }
            _ => None,
        };
        Ok(Self { control, data, buf: vec![0u8; 4097] })
    }

    fn data(&self) -> Result<&HidDevice, String> {
        self.data.as_ref().ok_or_else(|| "interface de imagem não aberta".to_string())
    }
}

impl Transport for HidTransport {
    fn send_feature(&mut self, packet: &Packet) -> Result<(), String> {
        // Report ID 0 (relatório sem número) + 64 bytes.
        let mut out = [0u8; 65];
        out[1..].copy_from_slice(packet);
        self.control
            .send_feature_report(&out)
            .map_err(|e| format!("falha ao enviar comando ao teclado: {e}"))
    }

    fn get_feature(&mut self) -> Result<(), String> {
        let mut buf = [0u8; 65];
        self.control.get_feature_report(&mut buf).map(|_| ()).map_err(|e| e.to_string())
    }

    fn send_data(&mut self, chunk: &[u8]) -> Result<(), String> {
        self.buf.clear();
        self.buf.push(0x00);
        self.buf.extend_from_slice(chunk);
        let buf = std::mem::take(&mut self.buf);
        let res = self.data()?.write(&buf);
        self.buf = buf;
        res.map(|_| ()).map_err(|e| format!("falha ao enviar bloco de imagem: {e}"))
    }

    fn read_data(&mut self, timeout_ms: i32) -> Result<Option<Vec<u8>>, String> {
        let mut buf = vec![0u8; 4200];
        let n = self
            .data()?
            .read_timeout(&mut buf, timeout_ms)
            .map_err(|e| format!("falha ao ler confirmação do teclado: {e}"))?;
        if n == 0 {
            return Ok(None);
        }
        buf.truncate(n);
        Ok(Some(buf))
    }

    fn drain_data(&mut self) {
        if let Some(d) = &self.data {
            let mut buf = vec![0u8; 4200];
            for _ in 0..16 {
                match d.read_timeout(&mut buf, 5) {
                    Ok(n) if n > 0 => continue,
                    _ => break,
                }
            }
        }
    }

    fn sleep_ms(&mut self, ms: u64) {
        thread::sleep(Duration::from_millis(ms));
    }
}
