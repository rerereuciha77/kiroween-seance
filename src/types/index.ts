export type Protocol = "gopher" | "nntp" | "finger";

export interface NormalisedRecord {
  kind: string;        // "menu" | "text" | "search" | "info" | "article" | "finger"
  selector: string;    // protocol-native address (gopher selector, NNTP message-id, finger user)
  label: string;       // human display string
  host: string;
  port: number;
  mime: string;        // "text/plain" | "text/html" | "message/rfc822" | etc.
  bytes: number;       // 0 if unknown
  author?: string;     // Usenet From header, when the protocol exposes one
  date?: string;       // Usenet Date header, raw RFC 5322 form
}

export interface Source {
  id: string;
  protocol: Protocol;
  host: string;
  port: number;
  description: string;
}

export interface CacheEntry {
  key: string;         // sha256 hex
  protocol: Protocol;
  host: string;
  selector: string;
  createdAt: number;   // Unix ms
  ttlMs: number;
  contentHash: string; // sha256 of body
  bodyPath: string;    // path to .body file on disk
  records?: NormalisedRecord[];
}

export interface SeanceSession {
  id: string;
  protocol: Protocol;
  host: string;
  port: number;
  breadcrumb: string[];  // selector stack
}
