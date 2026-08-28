#import "QuickLookPreviewComponentView.h"

#import <QuickLookUI/QuickLookUI.h>
#import <QuickLookThumbnailing/QuickLookThumbnailing.h>
#import <UniformTypeIdentifiers/UniformTypeIdentifiers.h>
#import <React/RCTConversions.h>
#import <react/renderer/components/EaktaViewerSpec/ComponentDescriptors.h>
#import <react/renderer/components/EaktaViewerSpec/EventEmitters.h>
#import <react/renderer/components/EaktaViewerSpec/Props.h>
#import <react/renderer/components/EaktaViewerSpec/RCTComponentViewHelpers.h>

using namespace facebook::react;

@interface QuickLookPreviewComponentView () <RCTQuickLookPreviewViewProtocol>
@end

@implementation QuickLookPreviewComponentView {
  QLPreviewView *_previewView;
  QLThumbnailGenerationRequest *_thumbnailRequest;
  NSUInteger _loadGeneration;
  BOOL _readinessPending;
}

+ (ComponentDescriptorProvider)componentDescriptorProvider
{
  return concreteComponentDescriptorProvider<QuickLookPreviewComponentDescriptor>();
}

- (instancetype)initWithFrame:(CGRect)frame
{
  if ((self = [super initWithFrame:frame])) {
    static const auto defaultProps = std::make_shared<const QuickLookPreviewProps>();
    _props = defaultProps;
    _previewView = [[QLPreviewView alloc] initWithFrame:frame style:QLPreviewViewStyleNormal];
    self.contentView = _previewView;
  }
  return self;
}

- (void)emitState:(QuickLookPreviewEventEmitter::OnPreviewStateState)state
             code:(const std::string &)code
{
  if (!_eventEmitter) {
    return;
  }
  auto emitter = std::static_pointer_cast<QuickLookPreviewEventEmitter const>(_eventEmitter);
  emitter->onPreviewState({.state = state, .code = code});
}

- (void)loadPreviewPath:(NSString *)path
{
  _loadGeneration += 1;
  const NSUInteger generation = _loadGeneration;
  if (_thumbnailRequest) {
    [QLThumbnailGenerator.sharedGenerator cancelRequest:_thumbnailRequest];
    _thumbnailRequest = nil;
  }
  _readinessPending = NO;
  _previewView.previewItem = nil;
  if (path.length == 0) {
    [self emitState:QuickLookPreviewEventEmitter::OnPreviewStateState::Error code:"empty-path"];
    return;
  }

  NSURL *url = [NSURL fileURLWithPath:path isDirectory:NO];
  if (![NSFileManager.defaultManager fileExistsAtPath:url.path]) {
    [self emitState:QuickLookPreviewEventEmitter::OnPreviewStateState::Error code:"missing-file"];
    return;
  }
  UTType *contentType = [UTType typeWithFilenameExtension:url.pathExtension];
  if ([contentType conformsToType:UTTypePDF]) {
    _previewView.previewItem = (id<QLPreviewItem>)url;
    [_previewView refreshPreviewItem];
    [self emitState:QuickLookPreviewEventEmitter::OnPreviewStateState::Ready code:""];
    return;
  }


  _readinessPending = YES;
  _thumbnailRequest = [[QLThumbnailGenerationRequest alloc]
    initWithFileAtURL:url
                 size:CGSizeMake(256, 256)
                scale:NSScreen.mainScreen.backingScaleFactor ?: 1
  representationTypes:QLThumbnailGenerationRequestRepresentationTypeThumbnail];
  [QLThumbnailGenerator.sharedGenerator
    generateBestRepresentationForRequest:_thumbnailRequest
    completionHandler:^(QLThumbnailRepresentation *representation, NSError *error) {
      dispatch_async(dispatch_get_main_queue(), ^{
        if (generation != self->_loadGeneration || !self->_readinessPending) return;
        self->_readinessPending = NO;
        self->_thumbnailRequest = nil;
        if (!representation || error) {
          [self emitState:QuickLookPreviewEventEmitter::OnPreviewStateState::Unsupported
                    code:"thumbnail-unavailable"];
          return;
        }
        self->_previewView.previewItem = (id<QLPreviewItem>)url;
        [self->_previewView refreshPreviewItem];
        [self emitState:QuickLookPreviewEventEmitter::OnPreviewStateState::Ready code:""];
      });
    }];
  dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(5 * NSEC_PER_SEC)),
                 dispatch_get_main_queue(), ^{
    if (generation != self->_loadGeneration || !self->_readinessPending) return;
    self->_readinessPending = NO;
    [QLThumbnailGenerator.sharedGenerator cancelRequest:self->_thumbnailRequest];
    self->_thumbnailRequest = nil;
    self->_previewView.previewItem = nil;
    [self emitState:QuickLookPreviewEventEmitter::OnPreviewStateState::Error
              code:"readiness-timeout"];
  });
}

- (void)updateProps:(Props::Shared const &)props oldProps:(Props::Shared const &)oldProps
{
  const auto &oldPreviewProps = *std::static_pointer_cast<QuickLookPreviewProps const>(_props);
  const auto &newPreviewProps = *std::static_pointer_cast<QuickLookPreviewProps const>(props);
  if (oldPreviewProps.previewPath != newPreviewProps.previewPath) {
    [self loadPreviewPath:RCTNSStringFromString(newPreviewProps.previewPath)];
  }
  [super updateProps:props oldProps:oldProps];
}

- (void)viewDidMoveToWindow
{
  [super viewDidMoveToWindow];
  if (self.window && !_previewView.previewItem && !_readinessPending) {
    const auto &previewProps =
      *std::static_pointer_cast<QuickLookPreviewProps const>(_props);
    if (!previewProps.previewPath.empty())
      [self loadPreviewPath:RCTNSStringFromString(previewProps.previewPath)];
  }
}

- (void)prepareForRecycle
{
  [super prepareForRecycle];
  _props = std::make_shared<const QuickLookPreviewProps>();
  _loadGeneration += 1;
  _readinessPending = NO;
  if (_thumbnailRequest) {
    [QLThumbnailGenerator.sharedGenerator cancelRequest:_thumbnailRequest];
    _thumbnailRequest = nil;
  }
  _previewView.previewItem = nil;
}

@end
