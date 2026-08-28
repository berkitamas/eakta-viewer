#import "ES3MenuController.h"

#import "ES3MacBridge.h"

static NSString *const ES3MenuStateChangedNotification = @"ES3MenuStateChanged";

@interface ES3MenuController ()
@property(nonatomic, strong) NSMutableDictionary<NSString *, NSMenuItem *> *items;
@end

@implementation ES3MenuController

- (instancetype)init
{
  if ((self = [super init])) {
    _items = [NSMutableDictionary dictionary];
    [NSNotificationCenter.defaultCenter addObserver:self
                                           selector:@selector(menuStateChanged:)
                                               name:ES3MenuStateChangedNotification
                                             object:nil];
  }
  return self;
}

- (NSMenuItem *)command:(NSString *)command
                  title:(NSString *)title
                    key:(NSString *)key
              modifiers:(NSEventModifierFlags)modifiers
{
  NSMenuItem *item = [[NSMenuItem alloc] initWithTitle:title action:@selector(performCommand:) keyEquivalent:key];
  item.target = self;
  item.representedObject = command;
  item.keyEquivalentModifierMask = modifiers;
  item.identifier = [@"menu." stringByAppendingString:command];
  self.items[command] = item;
  return item;
}

- (NSMenu *)submenu:(NSString *)title root:(NSMenu *)root
{
  NSMenuItem *rootItem = [[NSMenuItem alloc] initWithTitle:title action:nil keyEquivalent:@""];
  NSMenu *menu = [[NSMenu alloc] initWithTitle:title];
  rootItem.submenu = menu;
  [root addItem:rootItem];
  return menu;
}

- (void)installMainMenu
{
  NSEventModifierFlags command = NSEventModifierFlagCommand;
  NSMenu *main = [[NSMenu alloc] initWithTitle:@"e-Akta Viewer"];

  NSMenu *app = [self submenu:@"e-Akta Viewer" root:main];
  [app addItem:[self command:@"about" title:@"About e-Akta Viewer" key:@"" modifiers:0]];
  [app addItem:NSMenuItem.separatorItem];
  NSMenuItem *services = [[NSMenuItem alloc] initWithTitle:@"Services" action:nil keyEquivalent:@""];
  services.submenu = [[NSMenu alloc] initWithTitle:@"Services"];
  NSApplication.sharedApplication.servicesMenu = services.submenu;
  [app addItem:services];
  [app addItem:NSMenuItem.separatorItem];
  [app addItem:[[NSMenuItem alloc] initWithTitle:@"Hide e-Akta Viewer" action:@selector(hide:) keyEquivalent:@"h"]];
  NSMenuItem *hideOthers = [[NSMenuItem alloc] initWithTitle:@"Hide Others" action:@selector(hideOtherApplications:) keyEquivalent:@"h"];
  hideOthers.keyEquivalentModifierMask = command | NSEventModifierFlagOption;
  [app addItem:hideOthers];
  [app addItem:[[NSMenuItem alloc] initWithTitle:@"Show All" action:@selector(unhideAllApplications:) keyEquivalent:@""]];
  [app addItem:NSMenuItem.separatorItem];
  [app addItem:[[NSMenuItem alloc] initWithTitle:@"Quit e-Akta Viewer" action:@selector(terminate:) keyEquivalent:@"q"]];

  NSMenu *file = [self submenu:@"File" root:main];
  [file addItem:[self command:@"open-dossier" title:@"Open Dossier…" key:@"o" modifiers:command]];
  [file addItem:[self command:@"close-dossier" title:@"Close Dossier" key:@"w" modifiers:command]];
  [file addItem:NSMenuItem.separatorItem];
  [file addItem:[self command:@"export-selected" title:@"Export Selected…" key:@"e" modifiers:command]];
  [file addItem:[self command:@"export-all" title:@"Export All…" key:@"e" modifiers:command | NSEventModifierFlagShift]];

  NSMenu *view = [self submenu:@"View" root:main];
  [view addItem:[self command:@"documents" title:@"Documents" key:@"1" modifiers:command]];
  [view addItem:[self command:@"signatures" title:@"Signatures" key:@"2" modifiers:command]];
  [view addItem:NSMenuItem.separatorItem];
  [view addItem:[self command:@"toggle-inspector" title:@"Show Inspector" key:@"i" modifiers:command | NSEventModifierFlagOption]];

  NSMenu *language = [self submenu:@"Language" root:main];
  [language addItem:[self command:@"language-system" title:@"System" key:@"" modifiers:0]];
  [language addItem:[self command:@"language-en" title:@"English" key:@"" modifiers:0]];
  [language addItem:[self command:@"language-hu" title:@"Magyar" key:@"" modifiers:0]];

  NSMenu *window = [self submenu:@"Window" root:main];
  [window addItem:[[NSMenuItem alloc] initWithTitle:@"Minimize" action:@selector(performMiniaturize:) keyEquivalent:@"m"]];
  [window addItem:[[NSMenuItem alloc] initWithTitle:@"Zoom" action:@selector(performZoom:) keyEquivalent:@""]];
  NSApplication.sharedApplication.windowsMenu = window;

  NSMenu *help = [self submenu:@"Help" root:main];
  [help addItem:[self command:@"verification-privacy" title:@"Verification & Privacy" key:@"" modifiers:0]];
  NSApplication.sharedApplication.helpMenu = help;
  NSApplication.sharedApplication.mainMenu = main;
  [self applyAvailability:@{ @"hasDossier": @NO, @"hasSelectedExportable": @NO,
                             @"canExportAll": @NO, @"inspectorVisible": @NO,
                             @"language": @"system" }];
}

- (void)performCommand:(NSMenuItem *)sender
{
  [ES3MacBridge sendMenuCommand:sender.representedObject];
}

- (void)menuStateChanged:(NSNotification *)notification
{
  NSDictionary *state = notification.userInfo;
  NSDictionary *labels = state[@"labels"];
  NSDictionary *mapping = @{
    @"about": @"about", @"open-dossier": @"openDossier", @"close-dossier": @"closeDossier",
    @"export-selected": @"exportSelected", @"export-all": @"exportAll", @"documents": @"documents",
    @"signatures": @"signatures", @"verification-privacy": @"verificationPrivacy",
    @"language-system": @"system", @"language-en": @"english", @"language-hu": @"hungarian",
  };
  for (NSString *command in mapping) {
    NSString *title = labels[mapping[command]];
    if (title.length) self.items[command].title = title;
  }
  NSString *inspectorKey = [state[@"inspectorVisible"] boolValue] ? @"hideInspector" : @"showInspector";
  if ([labels[inspectorKey] length]) self.items[@"toggle-inspector"].title = labels[inspectorKey];
  [self applyAvailability:state];
}

- (void)applyAvailability:(NSDictionary *)state
{
  BOOL hasDossier = [state[@"hasDossier"] boolValue];
  self.items[@"close-dossier"].enabled = hasDossier;
  self.items[@"documents"].enabled = hasDossier;
  self.items[@"signatures"].enabled = hasDossier;
  self.items[@"toggle-inspector"].enabled = hasDossier;
  self.items[@"export-selected"].enabled = [state[@"hasSelectedExportable"] boolValue];
  self.items[@"export-all"].enabled = [state[@"canExportAll"] boolValue];
  NSString *language = state[@"language"] ?: @"system";
  self.items[@"language-system"].state = [language isEqualToString:@"system"] ? NSControlStateValueOn : NSControlStateValueOff;
  self.items[@"language-en"].state = [language isEqualToString:@"en"] ? NSControlStateValueOn : NSControlStateValueOff;
  self.items[@"language-hu"].state = [language isEqualToString:@"hu"] ? NSControlStateValueOn : NSControlStateValueOff;
}

@end
