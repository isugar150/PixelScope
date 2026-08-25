export interface CaptureRect {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

export interface CaptureViewportSize {
  readonly width: number;
  readonly height: number;
}

export interface CaptureScrollPosition {
  readonly x: number;
  readonly y: number;
}

export interface CaptureProgressState {
  readonly phase: 'capturing' | 'compositing';
  readonly completed: number;
  readonly total: number;
}

export interface StoredCapture {
  readonly id: string;
  readonly blob: Blob;
  readonly width: number;
  readonly height: number;
  readonly title: string;
  readonly createdAt: number;
}
