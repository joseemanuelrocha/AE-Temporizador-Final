export type LiveRole = 'host' | 'viewer';

export type LiveState = {
  public_code: string;
  mode: 'intervalos' | 'estacoes';
  status: 'idle' | 'running' | 'paused' | 'finished';
  phase: string;
  config: Record<string, number>;
  duration_ms: number;
  started_at: number | null;
  paused_remaining_ms: number | null;
  current_set: number;
  station: number;
  round: number;
  revision?: number;
};

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
export const liveAvailable = Boolean(url && key);
const headers = { apikey: key || '', Authorization: `Bearer ${key || ''}`, 'Content-Type': 'application/json' };

async function rpc<T>(name: string, body: Record<string, unknown>): Promise<T> {
  if (!liveAvailable) throw new Error('O treino em direto ainda não foi configurado.');
  const response = await fetch(`${url}/rest/v1/rpc/${name}`, { method: 'POST', headers, body: JSON.stringify(body) });
  const data = await response.json().catch(() => null) as { message?: string; hint?: string } | null;
  if (!response.ok) throw new Error(data?.message || data?.hint || 'Não foi possível contactar a sala.');
  return data as T;
}

export function roomCode() { return `AAE-${Math.floor(1000 + Math.random() * 9000)}`; }
export function deviceId() {
  const keyName = 'aae-live-device-id'; let id = localStorage.getItem(keyName);
  if (!id) { id = crypto.randomUUID(); localStorage.setItem(keyName, id); }
  return id;
}
export async function createRoom(state: LiveState) {
  const hostToken = crypto.randomUUID();
  await rpc('create_live_room', { p_public_code: state.public_code, p_host_token: hostToken, p_device_id: deviceId(), p_state: state });
  return hostToken;
}
export async function joinRoom(code: string) { return rpc<LiveState>('join_live_room', { p_public_code: code.toUpperCase(), p_device_id: deviceId() }); }
export async function getRoom(code: string) { return rpc<LiveState>('get_live_room', { p_public_code: code.toUpperCase() }); }
export async function updateRoom(code: string, hostToken: string, state: LiveState) { return rpc('update_live_room', { p_public_code: code, p_host_token: hostToken, p_state: state }); }
export async function leaveRoom(code: string) { return rpc('leave_live_room', { p_public_code: code, p_device_id: deviceId() }); }
