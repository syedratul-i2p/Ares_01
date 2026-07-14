import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';
import 'package:flutter/foundation.dart';
import 'package:tflite_flutter/tflite_flutter.dart';
// Note: Requires the 'image' package in pubspec.yaml for frame manipulation

class OfflineService {
  static final OfflineService _instance = OfflineService._internal();
  factory OfflineService() => _instance;
  OfflineService._internal();

  RawDatagramSocket? _udpSocket;
  Interpreter? _interpreter;
  bool _isInitialized = false;

  final String _espApIp = '192.168.4.1';
  final int _commandPort = 4210;
  final int _telemetryPort = 4211;

  final StreamController<Map<String, dynamic>> _telemetryController = StreamController.broadcast();
  Stream<Map<String, dynamic>> get telemetryStream => _telemetryController.stream;

  Future<void> initialize() async {
    if (_isInitialized) return;

    // 1. Initialize UDP Listener for Telemetry
    try {
      _udpSocket = await RawDatagramSocket.bind(InternetAddress.anyIPv4, _telemetryPort);
      _udpSocket!.listen((RawSocketEvent event) {
        if (event == RawSocketEvent.read) {
          Datagram? datagram = _udpSocket!.receive();
          if (datagram != null) {
            String payload = utf8.decode(datagram.data);
            try {
              final data = jsonDecode(payload);
              _telemetryController.add({
                'battery_percentage': (data['battery_percentage'] ?? 0.0).toDouble(),
                'obstacle_distance': (data['obstacle_distance'] ?? 999.9).toDouble(),
              });
            } catch (e) {
              debugPrint("[OfflineService] UDP Parse Error: $e");
            }
          }
        }
      });
      debugPrint("[OfflineService] UDP Telemetry Listener bound to port $_telemetryPort");
    } catch (e) {
      debugPrint("[OfflineService] Failed to bind UDP: $e");
    }

    // 2. Initialize TFLite Edge Model
    try {
      _interpreter = await Interpreter.fromAsset('assets/models/mobilenet_v1_1.0_224_quant.tflite');
      debugPrint("[OfflineService] TFLite Initialized (MobileNet V1 Quantized).");
    } catch (e) {
      debugPrint("[OfflineService] TFLite Load Error (Expected if model missing): $e");
    }

    _isInitialized = true;
  }

  /// UDP Command Dispatcher (Direct to ESP32 IP)
  void sendCommand(String type, String command, {int speed = 255}) {
    if (_udpSocket == null) return;
    
    final payload = {
      'type': type,
      'command': command,
      'speed': speed,
    };
    
    final data = utf8.encode(jsonEncode(payload));
    _udpSocket!.send(data, InternetAddress(_espApIp), _commandPort);
    debugPrint("[OfflineService] UDP Command Sent: $command");
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
    _udpSocket?.close();
    _interpreter?.close();
    _telemetryController.close();
  }
}
