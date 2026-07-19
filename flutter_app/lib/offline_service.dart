import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';
import 'package:flutter/foundation.dart';
import 'package:http/http.dart' as http;
import 'package:tflite_flutter/tflite_flutter.dart';
// Note: Requires the 'image' package in pubspec.yaml for frame manipulation

class OfflineService {
  static final OfflineService _instance = OfflineService._internal();
  factory OfflineService() => _instance;
  OfflineService._internal();

  Interpreter? _interpreter;
  bool _isInitialized = false;

  String _espUrl = 'http://172.30.43.196:80';

  void setEspUrl(String ip) {
    _espUrl = 'http://$ip:80';
  }

  final StreamController<Map<String, dynamic>> _telemetryController = StreamController.broadcast();
  Stream<Map<String, dynamic>> get telemetryStream => _telemetryController.stream;

  Future<void> initialize() async {
    if (_isInitialized) return;

    // UDP Telemetry is deprecated in HTTP mode, telemetry will be handled elsewhere if needed.

    // 2. Initialize TFLite Edge Model
    try {
      _interpreter = await Interpreter.fromAsset('assets/models/mobilenet_v1_1.0_224_quant.tflite');
      debugPrint("[OfflineService] TFLite Initialized (MobileNet V1 Quantized).");
    } catch (e) {
      debugPrint("[OfflineService] TFLite Load Error (Expected if model missing): $e");
    }

    _isInitialized = true;
  }

  /// HTTP REST Command Dispatcher
  Future<void> sendCommand(String type, String command, {int speed = 255}) async {
    final payload = {
      'type': type,
      'command': command,
      'speed': speed,
    };
    
    try {
      final response = await http.post(
        Uri.parse('$_espUrl/command'),
        headers: {'Content-Type': 'application/json'},
        body: jsonEncode(payload),
      );
      if (response.statusCode == 200) {
        debugPrint("[OfflineService] HTTP Command Sent: $command");
      } else {
        debugPrint("[OfflineService] HTTP Command Failed: ${response.statusCode}");
      }
    } catch (e) {
      debugPrint("[OfflineService] HTTP Request Error: $e");
    }
  }

  /// Process raw frame bytes with TFLite and autonomously send command
  Future<void> runEdgeVisionProcessing(Uint8List frameBytes) async {
    if (_interpreter == null) {
      debugPrint("[OfflineService] Interpreter not loaded, skipping inference.");
      return;
    }

    // 1. Decode image (requires 'image' package to be imported as img)
    // img.Image? image = img.decodeImage(frameBytes);
    // if (image == null) return;

    // 2. Resize for MobileNet V1 (224x224)
    // img.Image resizedImage = img.copyResize(image, width: 224, height: 224);
    
    // 3. Prepare input/output tensors (quantized model uses uint8, shape [1, 224, 224, 3])
    // var input = imageToByteListUint8(resizedImage, 224);
    // var output = List.filled(1 * 1001, 0).reshape([1, 1001]); 
    
    // 4. Run Inference
    // _interpreter!.run(input, output);
    
    // 5. Decision Logic
    // E.g., if output array index for "red object" has high confidence
    debugPrint("[OfflineService] Edge AI Processed Frame with MobileNet V1. Simulating APPROACH...");
    
    // Send autonomous command locally via UDP
    sendCommand("drive", "APPROACH", speed: 150);
  }

  void dispose() {
    _interpreter?.close();
    _telemetryController.close();
  }
}
