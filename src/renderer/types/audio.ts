export interface AudioSamplesEvent {
  type: "audio";
  timestamp: number;
  samples: number[];
}

export interface AudioStatusEvent {
  type: "status" | "error";
  status?: "started" | "permission-denied" | "stopped";
  message?: string;
}
