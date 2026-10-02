// Verifica se há commits novos no GitHub em relação ao código compilado.

import { api3, type BuildInfo } from "./api";

export type Commit = { sha: string; message: string; date: string; author: string };
export type UpdateCheck = {
  info: BuildInfo;
  /** null = não foi possível comparar */
  latest: Commit | null;
  newCommits: Commit[];
  upToDate: boolean;
  problem?: string;
};

const GH = "https://api.github.com/repos";

function toCommit(c: { sha: string; commit: { message: string; author?: { date?: string; name?: string } } }): Commit {
  return { sha: c.sha, message: c.commit.message.split("\n")[0], date: c.commit.author?.date ?? "", author: c.commit.author?.name ?? "" };
}

export async function checkForUpdates(): Promise<UpdateCheck> {
  const info = await api3.buildInfo();
  if (!info.repo || !info.commit) {
    return { info, latest: null, newCommits: [], upToDate: true, problem: "Este app não foi compilado a partir de um clone do GitHub (rode scripts\\update.ps1 dentro da pasta clonada)." };
  }
  const branch = info.branch && info.branch !== "HEAD" ? info.branch : "main";
  const r = await fetch(`${GH}/${info.repo}/commits/${encodeURIComponent(branch)}`, { headers: { Accept: "application/vnd.github+json" } });
  if (r.status === 404) return { info, latest: null, newCommits: [], upToDate: true, problem: `Repositório ${info.repo} não encontrado (ele precisa ser público).` };
  if (r.status === 403) return { info, latest: null, newCommits: [], upToDate: true, problem: "O GitHub limitou as consultas por agora. Tente de novo em alguns minutos." };
  if (!r.ok) throw new Error(`GitHub respondeu ${r.status}`);
  const latest = toCommit(await r.json());
  if (latest.sha === info.commit) return { info, latest, newCommits: [], upToDate: true };
  let newCommits: Commit[] = [];
  try {
    const c = await fetch(`${GH}/${info.repo}/compare/${info.commit}...${latest.sha}`);
    if (c.ok) {
      const j = await c.json();
      newCommits = (j.commits ?? []).map(toCommit).reverse();
      if (j.status === "behind" || j.status === "identical") return { info, latest, newCommits: [], upToDate: true };
    }
  } catch {
    /* sem a lista, ainda dá para atualizar */
  }
  if (!newCommits.length) newCommits = [latest];
  return { info, latest, newCommits, upToDate: false };
}
