#import "sleepAndLockObserver.h"
#import "activeWindowObserver.h"

// Custom Log Macro
#define MyLog(...) do {} while (0)

@implementation SleepAndLockObserver {
    __unsafe_unretained ActiveWindowObserver *_windowObserver;
}

- (id)initWithWindowObserver:(ActiveWindowObserver *)windowObserver {
    self = [super init];
    if (self) {
        _windowObserver = windowObserver;

        // Check initial screen lock state
        CFDictionaryRef sessionDict = CGSessionCopyCurrentDictionary();
        if (sessionDict) {
            BOOL isLocked = CFDictionaryGetValue(sessionDict, kCGSessionOnConsoleKey) == kCFBooleanFalse;
            if (isLocked) {
                [_windowObserver setSystemSuspension:@"lock"];
                // Create a lock event with current timestamp
                NSMutableDictionary *lockEvent = [@{
                    @"id": @0,
                    @"ownerName": @"System Lock",
                    @"title": @"Screen was locked",
                    @"type": @"system",
                    @"timestamp": @([[NSDate date] timeIntervalSince1970] * 1000)
                } mutableCopy];
                
                [_windowObserver sendWindowInfoToJS:lockEvent withReason:@"system_lock_initial"];
            }
            CFRelease(sessionDict);
        }
        
        // Get both workspace and distributed notification centers
        NSNotificationCenter *workspaceCenter = [[NSWorkspace sharedWorkspace] notificationCenter];
        NSNotificationCenter *distributedCenter = [NSDistributedNotificationCenter defaultCenter];
        
        // Subscriptions:
        // Workspace notifications (sleep/wake)
        [workspaceCenter addObserver:self
                           selector:@selector(receiveSleepNotification:)
                               name:NSWorkspaceWillSleepNotification
                             object:nil];
                                                               
        [workspaceCenter addObserver:self
                           selector:@selector(receiveWakeNotification:)
                               name:NSWorkspaceDidWakeNotification
                             object:nil];

        // Screen lock/unlock notifications (using distributed notifications)
        [distributedCenter addObserver:self
                            selector:@selector(receiveScreenLockNotification:)
                                name:@"com.apple.screenIsLocked"
                              object:nil];
        
        [distributedCenter addObserver:self
                            selector:@selector(receiveScreenUnlockNotification:)
                                name:@"com.apple.screenIsUnlocked"
                              object:nil];

        MyLog(@"🔧 DEBUG: Initialized observers for sleep/wake and lock/unlock events in SleepAndLockObserver");
    }
    return self;
}

- (void)receiveScreenLockNotification:(NSNotification *)notification {
    MyLog(@"🔒 DEBUG: Screen lock notification received");
    [_windowObserver setSystemSuspension:@"lock"];
    
    // Create a special lock event
    NSMutableDictionary *lockEvent = [@{
        @"id": @0,
        @"ownerName": @"System Lock",
        @"title": @"Screen was locked",
        @"type": @"system",
        @"timestamp": @([[NSDate date] timeIntervalSince1970] * 1000)
    } mutableCopy];
    
    MyLog(@"🔒 DEBUG: Sending lock event to JS: %@", lockEvent);
    [_windowObserver sendWindowInfoToJS:lockEvent withReason:@"system_lock"];
}

- (void)receiveScreenUnlockNotification:(NSNotification *)notification {
    MyLog(@"🔓 DEBUG: Screen unlock notification received");
    [_windowObserver setSystemSuspension:@"unlock"];
    
    // Create an unlock event
    NSMutableDictionary *unlockEvent = [@{
        @"id": @0,
        @"ownerName": @"System Unlock",
        @"title": @"Screen was unlocked",
        @"type": @"system",
        @"timestamp": @([[NSDate date] timeIntervalSince1970] * 1000)
    } mutableCopy];
    
    MyLog(@"🔓 DEBUG: Sending unlock event to JS: %@", unlockEvent);
    [_windowObserver sendWindowInfoToJS:unlockEvent withReason:@"system_unlock"];
}

- (void)receiveSleepNotification:(NSNotification *)notification {
    MyLog(@"💤 System going to sleep");
    [_windowObserver setSystemSuspension:@"sleep"];
    
    // Create a special sleep event
    NSMutableDictionary *sleepEvent = [@{
        @"ownerName": @"System Sleep",
        @"title": @"Computer was sleeping",
        @"type": @"system",
        @"timestamp": @([[NSDate date] timeIntervalSince1970] * 1000)
    } mutableCopy];
    
    [_windowObserver sendWindowInfoToJS:sleepEvent withReason:@"system_sleep"];
}

- (void)receiveWakeNotification:(NSNotification *)notification {
    MyLog(@"⏰ System waking up");
    [_windowObserver setSystemSuspension:@"wake"];
    
    // Create a wake event to mark the end of sleep period
    NSMutableDictionary *wakeEvent = [@{
        @"ownerName": @"System Wake",
        @"title": @"Computer woke from sleep",
        @"type": @"system",
        @"timestamp": @([[NSDate date] timeIntervalSince1970] * 1000)
    } mutableCopy];
    
    [_windowObserver sendWindowInfoToJS:wakeEvent withReason:@"system_wake"];
}

- (void)stopObserving {
    [[[NSWorkspace sharedWorkspace] notificationCenter] removeObserver:self];
    [[NSDistributedNotificationCenter defaultCenter] removeObserver:self];
}

// called before the object is deallocated/destroyed
- (void)dealloc {
    [self stopObserving];
    [super dealloc];
}

@end
