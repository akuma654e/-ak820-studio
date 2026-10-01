//! Protocolo do AJAZZ AK820 Pro (firmware original, modo com fio).
//!
//! Créditos: protocolo documentado por CraigSDel/ajazz-ak820-config (MIT),
//! aar-rafi/aks075-linux, gohv/EPOMAKER-Ajazz-AK820-Pro e
//! wsclx/ak820pro-modder (MIT).

pub mod effects;
pub mod image;
pub mod layout;
pub mod ops;
pub mod packets;

pub const VID: u16 = 0x0C45;
/// Modo com fio (USB-C).
pub const PID_WIRED: u16 = 0x8009;
/// Receptor 2.4 GHz (não expõe a interface de configuração).
pub const PID_DONGLE: u16 = 0xFEFE;
/// Bootloader (ISP).
pub const PID_BOOTLOADER: u16 = 0x7140;

pub const USAGE_PAGE_CONTROL: u16 = 0xFF13;
pub const USAGE_PAGE_DATA: u16 = 0xFF68;
pub const IFACE_CONTROL: i32 = 3;
pub const IFACE_DATA: i32 = 2;
