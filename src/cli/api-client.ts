export class ApiClient {
  constructor(private baseUrl: string) {}

  async get(path: string, token?: string): Promise<unknown> {
    const headers: Record<string, string> = {};
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const res = await fetch(`${this.baseUrl}${path}`, { headers });
    const body = await res.json();
    if (!res.ok) {
      throw new Error(body.error ?? `HTTP ${res.status}`);
    }
    return body;
  }

  async post(path: string, data: unknown, token?: string): Promise<unknown> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const res = await fetch(`${this.baseUrl}${path}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(data),
    });
    const body = await res.json();
    if (!res.ok) {
      throw new Error(body.error ?? `HTTP ${res.status}`);
    }
    return body;
  }

  async delete(path: string, token?: string): Promise<unknown> {
    const headers: Record<string, string> = {};
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const res = await fetch(`${this.baseUrl}${path}`, {
      method: 'DELETE',
      headers,
    });
    const body = await res.json();
    if (!res.ok) {
      throw new Error(body.error ?? `HTTP ${res.status}`);
    }
    return body;
  }
}
