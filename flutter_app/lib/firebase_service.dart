import 'dart:convert';
import 'package:flutter/foundation.dart';
import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_database/firebase_database.dart';
import 'package:firebase_storage/firebase_storage.dart';

class FirebaseService {
  static final FirebaseService _instance = FirebaseService._internal();
  factory FirebaseService() => _instance;
  FirebaseService._internal();

  late DatabaseReference _dbRef;
  late FirebaseStorage _storage;

  bool _isInitialized = false;

  // Streams for UI consumption
  Stream<Map<String, dynamic>>? telemetryStream;

  Future<void> initialize() async {
    if (_isInitialized) return;
    
    // Assumes Firebase.initializeApp() is already called in main.dart
    _dbRef = FirebaseDatabase.instance.ref();
    _storage = FirebaseStorage.instance;

    // 1. Setup Telemetry Listener (Works on Windows & Mobile)
    telemetryStream = _dbRef.child('ares_01/telemetry').onValue.map((event) {
      if (event.snapshot.value != null) {
        try {
          // Firebase RTDB returns dynamic maps, need to safely cast
          final Map<dynamic, dynamic> rawData = event.snapshot.value as Map<dynamic, dynamic>;
          return {
            'battery_percentage': (rawData['battery_percentage'] ?? 0.0).toDouble(),
            'obstacle_distance': (rawData['obstacle_distance'] ?? 999.9).toDouble(),
          };
        } catch (e) {
          debugPrint("[FirebaseService] Error parsing telemetry: $e");
        }
      }
      return {'battery_percentage': 0.0, 'obstacle_distance': 999.9};
    });

    _isInitialized = true;
    debugPrint("[FirebaseService] Initialized and Listening to Telemetry.");
  }

  /// 2. Command Dispatcher (Uplink to ESP32)
  Future<void> sendCommand(String action, String direction, {int speed = 255}) async {
    if (!_isInitialized) return;
    
    final payload = {
      'mode': 'manual',
      'action': action,
      'direction': direction,
      'speed': speed,
      'timestamp': ServerValue.timestamp, // Ensure the ESP32 registers a state change
    };

    try {
      await _dbRef.child('ares_01/commands/current_action').set(jsonEncode(payload));
      debugPrint("[FirebaseService] Command Dispatched: $action - $direction");
    } catch (e) {
      debugPrint("[FirebaseService] Failed to dispatch command: $e");
    }
  }

  /// 3. Live Feed Fetcher (Storage Download)
  /// Gets the latest frame URL for the Image.network() widget in the UI
  Future<String> getLiveFrameUrl() async {
    if (!_isInitialized) return "";
    try {
      final ref = _storage.ref().child('ares_01/camera/live_frame.jpg');
      return await ref.getDownloadURL();
    } catch (e) {
      debugPrint("[FirebaseService] Error fetching live frame URL: $e");
      return "";
    }
  }

  /// 4. Push Raw JSON Command (From AI Service)
  Future<void> sendRawJsonCommand(String rawJson) async {
    if (!_isInitialized) return;
    try {
      // Validate it's proper JSON before sending
      final decoded = jsonDecode(rawJson);
      decoded['timestamp'] = ServerValue.timestamp; // Force RTDB update trigger
      
      await _dbRef.child('ares_01/commands/current_action').set(jsonEncode(decoded));
      debugPrint("[FirebaseService] Raw JSON Command Dispatched: $rawJson");
    } catch (e) {
      debugPrint("[FirebaseService] Failed to dispatch raw JSON command: $e");
    }
  }

  /// 5. Update Navigation Mode
  Future<void> setNavigationMode(String mode) async {
    if (!_isInitialized) return;
    try {
      await _dbRef.child('ares_01/config/navigation_mode').set(mode);
      debugPrint("[FirebaseService] Navigation Mode set to: $mode");
    } catch (e) {
      debugPrint("[FirebaseService] Failed to set navigation mode: $e");
    }
  }
}
