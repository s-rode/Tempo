#import <EventKit/EventKit.h>
#import <Cocoa/Cocoa.h>
#include <napi.h>
#include "reminders.h"

// All EventKit access and object serialization runs on the Cocoa main queue.
// No EKObject crosses the bridge, and this file exposes no save/remove API.
static EKEventStore *reminderStore = nil;
static id reminderObserver = nil;
static Napi::ThreadSafeFunction reminderChanged;

static EKEventStore *Store() {
  if (!reminderStore) reminderStore = [[EKEventStore alloc] init];
  return reminderStore;
}
static NSString *Permission() {
  EKAuthorizationStatus status = [EKEventStore authorizationStatusForEntityType:EKEntityTypeReminder];
  if (status == EKAuthorizationStatusNotDetermined) return @"not_determined";
  if (status == EKAuthorizationStatusAuthorized) return @"granted";
  return @"denied";
}
static void Deliver(Napi::ThreadSafeFunction callback, NSDictionary *value) {
  NSData *data = [NSJSONSerialization dataWithJSONObject:value options:0 error:nil];
  auto json = new std::string(data ? std::string((const char *)data.bytes, data.length) : "{\"error\":\"fetch_failed\"}");
  napi_status status = callback.NonBlockingCall(json, [](Napi::Env env, Napi::Function fn, std::string *result) {
    fn.Call({ Napi::String::New(env, *result) });
    delete result;
  });
  if (status != napi_ok) delete json;
  callback.Release();
}
static Napi::ThreadSafeFunction Callback(const Napi::CallbackInfo &info) {
  return Napi::ThreadSafeFunction::New(info.Env(), info[0].As<Napi::Function>(), "tempo-reminders", 0, 1);
}

void RegisterCalendars(Napi::Env env, Napi::Object exports);
void RegisterReminders(Napi::Env env, Napi::Object exports) {
  RegisterCalendars(env, exports);
  exports.Set("getRemindersPermission", Napi::Function::New(env, [](const Napi::CallbackInfo &info) -> Napi::Value {
    return Napi::String::New(info.Env(), [Permission() UTF8String]);
  }));
  exports.Set("requestRemindersAccess", Napi::Function::New(env, [](const Napi::CallbackInfo &info) {
    auto callback = Callback(info);
    dispatch_async(dispatch_get_main_queue(), ^{
      void (^completion)(BOOL, NSError *) = ^(BOOL granted, NSError *error) {
        Deliver(callback, @{ @"permission": Permission() });
      };
      if (@available(macOS 14.0, *)) [Store() requestFullAccessToRemindersWithCompletion:completion];
      else [Store() requestAccessToEntityType:EKEntityTypeReminder completion:completion];
    });
  }));
  exports.Set("fetchReminders", Napi::Function::New(env, [](const Napi::CallbackInfo &info) {
    auto callback = Callback(info);
    dispatch_async(dispatch_get_main_queue(), ^{
      if (![Permission() isEqualToString:@"granted"]) {
        Deliver(callback, @{ @"error": @"permission_denied" });
        return;
      }
      NSArray<EKCalendar *> *calendars = [Store() calendarsForEntityType:EKEntityTypeReminder];
      NSMutableArray *lists = [NSMutableArray array];
      for (EKCalendar *calendar in calendars) {
        [lists addObject:@{ @"id": calendar.calendarIdentifier, @"name": calendar.title ?: @"",
                           @"accountName": calendar.source.title ?: @"" }];
      }
      // An explicit empty list set is a valid complete snapshot.
      if (!calendars.count) {
        Deliver(callback, @{ @"snapshot": @{ @"lists": lists, @"reminders": @[] } });
        return;
      }
      NSPredicate *predicate = [Store() predicateForRemindersInCalendars:calendars];
      [Store() fetchRemindersMatchingPredicate:predicate completion:^(NSArray<EKReminder *> *items) {
        dispatch_async(dispatch_get_main_queue(), ^{
          if (!items || ![Permission() isEqualToString:@"granted"]) {
            Deliver(callback, @{ @"error": [Permission() isEqualToString:@"granted"] ? @"fetch_failed" : @"permission_denied" });
            return;
          }
          NSMutableArray *reminders = [NSMutableArray array];
          for (EKReminder *item in items) {
            if (item.completed) continue;
            NSDateComponents *components = item.dueDateComponents;
            id due = [NSNull null];
            if (components && components.year != NSDateComponentUndefined && components.month != NSDateComponentUndefined && components.day != NSDateComponentUndefined) {
              NSMutableDictionary *parts = [NSMutableDictionary dictionaryWithDictionary:@{
                @"year": @(components.year), @"month": @(components.month), @"day": @(components.day) }];
              if (components.hour != NSDateComponentUndefined) {
                parts[@"hour"] = @(components.hour);
                parts[@"minute"] = @(components.minute == NSDateComponentUndefined ? 0 : components.minute);
                if (components.timeZone) {
                  parts[@"timeZone"] = components.timeZone.name;
                  NSCalendar *calendar = [[NSCalendar alloc] initWithCalendarIdentifier:NSCalendarIdentifierGregorian];
                  calendar.timeZone = components.timeZone;
                  NSDate *date = [calendar dateFromComponents:components];
                  if (date) parts[@"timestampMs"] = @([date timeIntervalSince1970] * 1000);
                  [calendar release];
                }
              }
              due = parts;
            }
            [reminders addObject:@{ @"sourceId": item.calendarItemIdentifier, @"title": item.title ?: @"",
              @"listId": item.calendar.calendarIdentifier, @"due": due, @"completed": @NO }];
          }
          Deliver(callback, @{ @"snapshot": @{ @"lists": lists, @"reminders": reminders } });
        });
      }];
    });
  }));
  exports.Set("startRemindersObserver", Napi::Function::New(env, [](const Napi::CallbackInfo &info) {
    if (reminderObserver) return;
    reminderChanged = Callback(info);
    reminderChanged.Unref(info.Env());
    dispatch_async(dispatch_get_main_queue(), ^{
      reminderObserver = [[NSNotificationCenter defaultCenter] addObserverForName:EKEventStoreChangedNotification object:Store() queue:[NSOperationQueue mainQueue] usingBlock:^(NSNotification *notification) {
        reminderChanged.NonBlockingCall([](Napi::Env env, Napi::Function fn) { fn.Call({}); });
      }];
    });
  }));
  env.AddCleanupHook([] {
    if (reminderObserver) {
      [[NSNotificationCenter defaultCenter] removeObserver:reminderObserver];
      reminderObserver = nil;
      reminderChanged.Abort();
    }
  });
}

// Separate read-only Calendar bridge. Event titles and times stay on this Mac;
// no Calendar save/remove operation is exported by the addon.
static EKEventStore *calendarStore = nil;
static id calendarObserver = nil;
static Napi::ThreadSafeFunction calendarChanged;
static EKEventStore *CalendarStore() {
  if (!calendarStore) calendarStore = [[EKEventStore alloc] init];
  return calendarStore;
}
static NSString *CalendarPermission() {
  EKAuthorizationStatus status = [EKEventStore authorizationStatusForEntityType:EKEntityTypeEvent];
  if (status == EKAuthorizationStatusNotDetermined) return @"not_determined";
  if (@available(macOS 14.0, *)) return status == EKAuthorizationStatusFullAccess ? @"granted" : @"denied";
  return status == EKAuthorizationStatusAuthorized ? @"granted" : @"denied";
}
void RegisterCalendars(Napi::Env env, Napi::Object exports) {
  exports.Set("getCalendarPermission", Napi::Function::New(env, [](const Napi::CallbackInfo &info) -> Napi::Value {
    return Napi::String::New(info.Env(), [CalendarPermission() UTF8String]);
  }));
  exports.Set("requestCalendarAccess", Napi::Function::New(env, [](const Napi::CallbackInfo &info) {
    auto callback = Callback(info);
    dispatch_async(dispatch_get_main_queue(), ^{
      if (@available(macOS 14.0, *)) {
        [CalendarStore() requestFullAccessToEventsWithCompletion:^(BOOL granted, NSError *error) {
          dispatch_async(dispatch_get_main_queue(), ^{
            if (granted) [CalendarStore() reset];
            Deliver(callback, @{ @"permission": granted ? @"granted" : CalendarPermission(),
              @"authorizationStatus": @([EKEventStore authorizationStatusForEntityType:EKEntityTypeEvent]),
              @"errorCode": error ? @(error.code) : @0 });
          });
        }];
      } else Deliver(callback, @{ @"permission": @"denied" });
    });
  }));
  exports.Set("fetchCalendarEvents", Napi::Function::New(env, [](const Napi::CallbackInfo &info) {
    double startMs = info[0].As<Napi::Number>().DoubleValue();
    double endMs = info[1].As<Napi::Number>().DoubleValue();
    auto callback = Napi::ThreadSafeFunction::New(info.Env(), info[2].As<Napi::Function>(), "tempo-calendar", 0, 1);
    dispatch_async(dispatch_get_main_queue(), ^{
      if (![CalendarPermission() isEqualToString:@"granted"]) {
        Deliver(callback, @{ @"error": @"permission_denied" }); return;
      }
      @try {
        NSArray<EKCalendar *> *calendars = [CalendarStore() calendarsForEntityType:EKEntityTypeEvent];
        NSMutableArray *sources = [NSMutableArray array];
        for (EKCalendar *calendar in calendars) {
          NSColor *color = calendar.CGColor ? [[NSColor colorWithCGColor:calendar.CGColor] colorUsingColorSpace:NSColorSpace.sRGBColorSpace] : nil;
          NSString *hex = color ? [NSString stringWithFormat:@"#%02x%02x%02x", (int)round(color.redComponent*255), (int)round(color.greenComponent*255), (int)round(color.blueComponent*255)] : @"#5e81ac";
          [sources addObject:@{ @"id": calendar.calendarIdentifier, @"title": calendar.title ?: @"Calendar", @"accountName": calendar.source.title ?: @"", @"color": hex }];
        }
        NSMutableArray *events = [NSMutableArray array];
        if (calendars.count) {
          NSPredicate *predicate = [CalendarStore() predicateForEventsWithStartDate:[NSDate dateWithTimeIntervalSince1970:startMs/1000] endDate:[NSDate dateWithTimeIntervalSince1970:endMs/1000] calendars:calendars];
          for (EKEvent *event in [CalendarStore() eventsMatchingPredicate:predicate]) {
            if (event.status == EKEventStatusCanceled || !event.startDate || !event.endDate) continue;
            BOOL declined = NO;
            for (EKParticipant *person in event.attendees) if (person.isCurrentUser && person.participantStatus == EKParticipantStatusDeclined) declined = YES;
            if (declined) continue;
            NSString *identity = [NSString stringWithFormat:@"%@:%@:%@", event.calendar.calendarIdentifier, event.calendarItemIdentifier,
              event.occurrenceDate ? @([event.occurrenceDate timeIntervalSince1970]*1000).stringValue : @"single"];
            [events addObject:@{ @"id": identity, @"calendarId": event.calendar.calendarIdentifier,
              @"title": event.title.length ? event.title : @"Untitled event", @"startMs": @([event.startDate timeIntervalSince1970]*1000),
              @"endMs": @([event.endDate timeIntervalSince1970]*1000), @"allDay": @(event.allDay), @"location": event.location ?: @"" }];
          }
        }
        Deliver(callback, @{ @"snapshot": @{ @"calendars": sources, @"events": events } });
      } @catch (NSException *exception) { Deliver(callback, @{ @"error": @"fetch_failed" }); }
    });
  }));
  exports.Set("startCalendarObserver", Napi::Function::New(env, [](const Napi::CallbackInfo &info) {
    if (calendarObserver) return;
    calendarChanged = Callback(info); calendarChanged.Unref(info.Env());
    dispatch_async(dispatch_get_main_queue(), ^{
      calendarObserver = [[NSNotificationCenter defaultCenter] addObserverForName:EKEventStoreChangedNotification object:CalendarStore() queue:[NSOperationQueue mainQueue] usingBlock:^(NSNotification *notification) {
        calendarChanged.NonBlockingCall([](Napi::Env env, Napi::Function fn) { fn.Call({}); });
      }];
    });
  }));
  env.AddCleanupHook([] { if (calendarObserver) {
    [[NSNotificationCenter defaultCenter] removeObserver:calendarObserver]; calendarObserver = nil; calendarChanged.Abort();
  } });
}
