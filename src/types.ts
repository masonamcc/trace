export interface Event {
  id?: number;
  timestamp: string;
  source: "desktop" | "chrome";
  app?: string;
  window_title?: string;
  url?: string;
  page_title?: string;
}

export interface Session {
  start: string;
  end: string;
  label: string;
  detail: string;
  source: "desktop" | "chrome";
  eventCount: number;
}
