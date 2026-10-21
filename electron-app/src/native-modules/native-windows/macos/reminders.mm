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

void RegisterReminders(Napi::Env env, Napi::Object exports) {
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
