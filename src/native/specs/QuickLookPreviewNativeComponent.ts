import type { ViewProps } from 'react-native';
import type { DirectEventHandler } from 'react-native/Libraries/Types/CodegenTypes';
import codegenNativeComponent from 'react-native/Libraries/Utilities/codegenNativeComponent';

export type PreviewStateEvent = Readonly<{
  state: 'ready' | 'unsupported' | 'error';
  code?: string;
}>;

export interface NativeProps extends ViewProps {
  previewPath: string;
  onPreviewState?: DirectEventHandler<PreviewStateEvent>;
}

export default codegenNativeComponent<NativeProps>('QuickLookPreview');
