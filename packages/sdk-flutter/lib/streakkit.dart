// streakkit.dart: Universal Single-File Drop-In Streak Engine for Flutter
// Drop into any Flutter project in lib/streakkit.dart
// Zero-dashboard setup, offline-resilient, with animated embed WebView support.

import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;

typedef MilestoneCallback = void Function(String ruleSlug, int milestoneDay);
typedef StateChangeCallback = void Function(Map<String, dynamic> state);

class StreakKit {
  static String endpoint = "http://10.0.2.2:3000";
  static String publicKey = "pk_live_default";
  static String currentUserId = "user_default";

  static final List<MilestoneCallback> _milestoneListeners = [];
  static final List<StateChangeCallback> _stateListeners = [];
  static Map<String, dynamic>? _lastState;

  /// Initialize StreakKit with public API key and optional user ID.
  static void init({
    required String key,
    String? apiEndpoint,
    String? userId,
  }) {
    publicKey = key;
    if (apiEndpoint != null) endpoint = apiEndpoint;
    if (userId != null) currentUserId = userId;
  }

  /// Listen for when a user unlocks a milestone day (e.g. 7, 30, 100 days)
  static void onMilestoneReached(MilestoneCallback callback) {
    _milestoneListeners.add(callback);
  }

  /// Listen for real-time streak state changes
  static void onStateChange(StateChangeCallback callback) {
    _stateListeners.add(callback);
  }

  /// 1-Line Ping: Records activity and increments user streak.
  static Future<Map<String, dynamic>?> ping(
    String ruleSlug, {
    int value = 1,
    String? userId,
  }) async {
    final uid = userId ?? currentUserId;
    final url = Uri.parse("${endpoint.replaceAll(RegExp(r'/+$'), '')}/v1/ping");

    try {
      final res = await http.post(
        url,
        headers: {
          "Authorization": "Bearer $publicKey",
          "Content-Type": "application/json",
        },
        body: jsonEncode({
          "ruleSlug": ruleSlug,
          "externalUserId": uid,
          "value": value,
          "timezone": DateTime.now().timeZoneName,
        }),
      );

      if (res.statusCode == 200) {
        final data = jsonDecode(res.body) as Map<String, dynamic>;
        _lastState = data;

        for (final listener in _stateListeners) {
          listener(data);
        }

        final milestone = data["milestone"] as Map<String, dynamic>?;
        final justReached = milestone?["justReached"];
        if (justReached != null && justReached is int && justReached > 0) {
          for (final ml in _milestoneListeners) {
            ml(ruleSlug, justReached);
          }
        }

        return data;
      }
    } catch (_) {}
    return null;
  }

  /// Evaluates Behavioral Contrast Nudges (e.g., Music vs Deen or Reels vs Language)
  static Future<Map<String, dynamic>?> evaluateContrastNudge({
    required String neglectedRuleSlug,
    required String triggerAction,
    required String triggerLabel,
    int? durationMinutes,
    String archetype = "GUILT_PRIORITY",
    String? userId,
  }) async {
    final uid = userId ?? currentUserId;
    final url = Uri.parse("${endpoint.replaceAll(RegExp(r'/+$'), '')}/v1/notifications/contrast");

    try {
      final res = await http.post(
        url,
        headers: {
          "Authorization": "Bearer $publicKey",
          "Content-Type": "application/json",
        },
        body: jsonEncode({
          "userId": uid,
          "neglectedRuleSlug": neglectedRuleSlug,
          "triggerActivity": {
            "action": triggerAction,
            "label": triggerLabel,
            if (durationMinutes != null) "durationMinutes": durationMinutes,
          },
          "archetype": archetype,
        }),
      );

      if (res.statusCode == 200) {
        return jsonDecode(res.body) as Map<String, dynamic>;
      }
    } catch (_) {}
    return null;
  }

  /// Streak Amnesty: Checks if a churned user qualifies for streak resurrection.
  static Future<Map<String, dynamic>?> checkAmnesty(
    String ruleSlug, {
    String? userId,
    int minDormantDays = 7,
  }) async {
    final uid = userId ?? currentUserId;
    final url = Uri.parse("${endpoint.replaceAll(RegExp(r'/+$'), '')}/v1/streak/amnesty/evaluate");

    try {
      final res = await http.post(
        url,
        headers: {
          "Authorization": "Bearer $publicKey",
          "Content-Type": "application/json",
        },
        body: jsonEncode({
          "ruleSlug": ruleSlug,
          "externalUserId": uid,
          "minDormantDays": minDormantDays,
        }),
      );

      if (res.statusCode == 200) {
        final data = jsonDecode(res.body) as Map<String, dynamic>;
        return data["evaluation"] as Map<String, dynamic>?;
      }
    } catch (_) {}
    return null;
  }

  /// Claims Streak Amnesty, resurrecting the broken streak without resetting to 0.
  static Future<int?> claimAmnesty(
    String ruleSlug, {
    String? userId,
  }) async {
    final uid = userId ?? currentUserId;
    final url = Uri.parse("${endpoint.replaceAll(RegExp(r'/+$'), '')}/v1/streak/amnesty/claim");

    try {
      final res = await http.post(
        url,
        headers: {
          "Authorization": "Bearer $publicKey",
          "Content-Type": "application/json",
        },
        body: jsonEncode({
          "ruleSlug": ruleSlug,
          "externalUserId": uid,
        }),
      );

      if (res.statusCode == 200) {
        final data = jsonDecode(res.body) as Map<String, dynamic>;
        return data["resurrectedStreak"] as int?;
      }
    } catch (_) {}
    return null;
  }

  /// Returns embed URL to display the 60fps Duolingo-grade modal UI in any WebView.
  static String getEmbedUrl(String ruleSlug, {String? userId}) {
    final uid = userId ?? currentUserId;
    return "${endpoint.replaceAll(RegExp(r'/+$'), '')}/v1/embed/$ruleSlug/$uid";
  }

  /// Returns embed URL to display the full Duolingo Winding Path UI (Top Bar + Daily XP + Unit Nodes).
  static String getDuolingoPathUrl(
    String ruleSlug, {
    String? userId,
    String flag = "🇳🇬",
    String unitTitle = "Greetings",
  }) {
    final uid = userId ?? currentUserId;
    final f = Uri.encodeComponent(flag);
    final ut = Uri.encodeComponent(unitTitle);
    return "${endpoint.replaceAll(RegExp(r'/+$'), '')}/v1/embed/path/$ruleSlug/$uid?flag=$f&unitTitle=$ut";
  }

  /// Deducts a heart when a user makes a mistake in a lesson/quiz.
  static Future<Map<String, dynamic>?> consumeHeart({int count = 1, String? userId}) async {
    final uid = userId ?? currentUserId;
    final url = Uri.parse("${endpoint.replaceAll(RegExp(r'/+$'), '')}/v1/gamification/hearts/consume");
    try {
      final res = await http.post(
        url,
        headers: {"Authorization": "Bearer $publicKey", "Content-Type": "application/json"},
        body: jsonEncode({"userId": uid, "count": count}),
      );
      if (res.statusCode == 200) return jsonDecode(res.body) as Map<String, dynamic>;
    } catch (_) {}
    return null;
  }

  /// Refills hearts via GEMS (50 gems), PRACTICE (+1 heart), or AD (+1 heart).
  static Future<Map<String, dynamic>?> refillHearts({String method = "GEMS", String? userId}) async {
    final uid = userId ?? currentUserId;
    final url = Uri.parse("${endpoint.replaceAll(RegExp(r'/+$'), '')}/v1/gamification/hearts/refill");
    try {
      final res = await http.post(
        url,
        headers: {"Authorization": "Bearer $publicKey", "Content-Type": "application/json"},
        body: jsonEncode({"userId": uid, "method": method}),
      );
      if (res.statusCode == 200) return jsonDecode(res.body) as Map<String, dynamic>;
    } catch (_) {}
    return null;
  }

  /// Awards XP toward the daily goal (e.g. +10 XP for completing a lesson).
  static Future<Map<String, dynamic>?> addXp(int amount, {String? unitId, String? userId}) async {
    final uid = userId ?? currentUserId;
    final url = Uri.parse("${endpoint.replaceAll(RegExp(r'/+$'), '')}/v1/gamification/xp/add");
    try {
      final res = await http.post(
        url,
        headers: {"Authorization": "Bearer $publicKey", "Content-Type": "application/json"},
        body: jsonEncode({
          "userId": uid,
          "amount": amount,
          if (unitId != null) "unitId": unitId,
        }),
      );
      if (res.statusCode == 200) return jsonDecode(res.body) as Map<String, dynamic>;
    } catch (_) {}
    return null;
  }
}
