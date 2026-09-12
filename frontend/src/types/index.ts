export interface HealthResponse {
  status: string;
  database?: string;
}

export interface ApiState<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
}
