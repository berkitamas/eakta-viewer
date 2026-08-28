import 'react-native';

interface MacFileDropEvent {
  dataTransfer?: {
    files?: Array<{ uri: string }>;
  };
}

declare module 'react-native' {
  interface ViewProps {
    draggedTypes?: string;
    onDragEnter?: (event: NativeSyntheticEvent<MacFileDropEvent>) => void;
    onDragLeave?: (event: NativeSyntheticEvent<MacFileDropEvent>) => void;
    onDrop?: (event: NativeSyntheticEvent<MacFileDropEvent>) => void;
  }
}
