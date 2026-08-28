#import "AppDelegate.h"
#import "ES3MacBridge.h"
#import "ES3MenuController.h"

#import <React/RCTBundleURLProvider.h>
#import <ReactAppDependencyProvider/RCTAppDependencyProvider.h>

@interface AppDelegate ()
@property(nonatomic, strong) ES3MenuController *menuController;
@end

@implementation AppDelegate

- (void)applicationDidFinishLaunching:(NSNotification *)notification
{
  self.moduleName = @"EaktaViewer";
  self.initialProps = @{};
  self.dependencyProvider = [RCTAppDependencyProvider new];
  [super applicationDidFinishLaunching:notification];
  self.menuController = [ES3MenuController new];
  [self.menuController installMainMenu];
  NSWindow *window = NSApplication.sharedApplication.mainWindow;
  window.minSize = NSMakeSize(1100, 720);
}

- (void)application:(NSApplication *)application openFiles:(NSArray<NSString *> *)filenames
{
  for (NSString *filename in filenames) {
    [ES3MacBridge enqueueFinderURL:[NSURL fileURLWithPath:filename isDirectory:NO]];
  }
  [application replyToOpenOrPrint:NSApplicationDelegateReplySuccess];
}

- (BOOL)applicationShouldTerminateAfterLastWindowClosed:(NSApplication *)sender
{
  return NO;
}

- (NSURL *)sourceURLForBridge:(RCTBridge *)bridge
{
  return [self bundleURL];
}

- (NSURL *)bundleURL
{
#if DEBUG
  return [[RCTBundleURLProvider sharedSettings] jsBundleURLForBundleRoot:@"index"];
#else
  return [[NSBundle mainBundle] URLForResource:@"main" withExtension:@"jsbundle"];
#endif
}

/// This method controls whether the `concurrentRoot`feature of React18 is turned on or off.
///
/// @see: https://reactjs.org/blog/2022/03/29/react-v18.html
/// @note: This requires to be rendering on Fabric (i.e. on the New Architecture).
/// @return: `true` if the `concurrentRoot` feature is enabled. Otherwise, it returns `false`.
- (BOOL)concurrentRootEnabled
{
#ifdef RN_FABRIC_ENABLED
  return true;
#else
  return false;
#endif
}

@end
