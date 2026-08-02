import 'dart:async';
import 'dart:convert';
import 'dart:ui';
import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;
import 'package:web_socket_channel/web_socket_channel.dart';
import 'firebase_service.dart';
import 'ai_service.dart';
import 'offline_service.dart';

enum RoverMode { manual, autonomous }

class DualBrainDashboard extends StatefulWidget {
  const DualBrainDashboard({Key? key}) : super(key: key);

  @override
  _DualBrainDashboardState createState() => _DualBrainDashboardState();
}

class _DualBrainDashboardState extends State<DualBrainDashboard> {
  final FirebaseService _firebaseService = FirebaseService();
  final OfflineService _offlineService = OfflineService();
  
  // Dual-Brain State
  bool _isOfflineMode = false;
  RoverMode _currentMode = RoverMode.manual;
  Timer? _visionTimer;

  double? _batteryPercentage = null;
  double _obstacleDistance = 999.9;
  int _rssi = 0;
  int _heap = 0;
  
  // Arm State
  double _baseAngle = 90;
  double _shoulderAngle = 90;
  double _elbowAngle = 90;
  double _wristAngle = 90;
  double _gripperAngle = 90;

  String _liveFrameUrl = "";
  Timer? _frameTimer;
  WebSocketChannel? _wsChannel;
  StreamSubscription? _wsSub;
  StreamSubscription? _telemetrySub;
  StreamSubscription? _offlineTelemetrySub;
  
  // Local MJPEG Stream
  String _localMjpegStream = "http://172.30.43.196:80/stream";
  String _localCommandHost = "172.30.43.196";
  bool _isLocalAiProcessing = false;
  Timer? _localAiTimer;
  
  // AI Commander State
  final TextEditingController _aiCommandController = TextEditingController();
  bool _isAiProcessing = false;
  String userInstruction = "";

  // Debounce Timer for Manual Controls
  Timer? _debounceTimer;

  @override
  void initState() {
    super.initState();
    _initBridge();
  }

  Future<void> _initBridge() async {
    // Init Online Cloud
    await _firebaseService.initialize();
    await AIService().initialize();
    
    // Init Offline Edge
    await _offlineService.initialize();
    
    _switchMode(_isOfflineMode);
    _connectWebSocket();
  }

  String _extractIp(String url) {
    final RegExp regex = RegExp(r'(?:https?:\/\/)?([0-9]+\.[0-9]+\.[0-9]+\.[0-9]+)');
    final match = regex.firstMatch(url);
    if (match != null) {
      return match.group(1) ?? "";
    }
    return "";
  }

  void _connectWebSocket() {
    _wsSub?.cancel();
    try {
      String ip = _extractIp(_localCommandHost);
      if (ip.isEmpty) {
        ip = _extractIp(_localMjpegStream);
      }
      if (ip.isEmpty) {
        debugPrint("[ARES-01] Could not extract raw IP for WebSocket from $_localCommandHost or $_localMjpegStream");
        return;
      }
      final wsUrl = 'ws://$ip:81/';
      debugPrint("[ARES-01] Auto-init WebSocket telemetry to: $wsUrl");
      _wsChannel = WebSocketChannel.connect(Uri.parse(wsUrl));
      _wsSub = _wsChannel?.stream.listen((message) {
        try {
          final data = jsonDecode(message);
          if (mounted) {
            setState(() {
              if (data['battery'] != null) _batteryPercentage = data['battery'].toDouble();
              else _batteryPercentage = null;
              if (data['distance'] != null) _obstacleDistance = data['distance'].toDouble();
              if (data['rssi'] != null) _rssi = data['rssi'].toInt();
              if (data['heap'] != null) _heap = data['heap'].toInt();
            });
          }
        } catch (e) {
          debugPrint("WebSocket parsing error: $e");
        }
      }, onDone: () {
        if (mounted) setState(() { _batteryPercentage = null; _obstacleDistance = 0; _rssi = 0; _heap = 0; });
        Future.delayed(const Duration(seconds: 3), _connectWebSocket);
      }, onError: (e) {
        if (mounted) setState(() { _batteryPercentage = null; _obstacleDistance = 0; _rssi = 0; _heap = 0; });
        Future.delayed(const Duration(seconds: 3), _connectWebSocket);
      });
    } catch (e) {
      debugPrint("WebSocket init error: $e");
    }
  }

  void _switchMode(bool offline) {
    setState(() {
      _isOfflineMode = offline;
    });

    _telemetrySub?.cancel();
    _offlineTelemetrySub?.cancel();
    _frameTimer?.cancel();
    _localAiTimer?.cancel();

    if (_isOfflineMode) {
      // Offline Mode: UDP Telemetry
      _offlineTelemetrySub = _offlineService.telemetryStream.listen((data) {
        if (mounted) setState(() {
          _batteryPercentage = data['battery_percentage'] != null ? data['battery_percentage'].toDouble() : null;
          _obstacleDistance = data['obstacle_distance'];
        });
      });

      // Simulate local TFLite auto-processing loop on MJPEG frames
      _localAiTimer = Timer.periodic(const Duration(seconds: 1), (timer) async {
        if (_isLocalAiProcessing) return;
        setState(() => _isLocalAiProcessing = true);
        
        try {
          // Fetch one raw frame from the local capture endpoint
          final response = await http.get(Uri.parse('http://172.30.43.196:80/capture'));
          
          if (response.statusCode == 200) {
            await _offlineService.runEdgeVisionProcessing(response.bodyBytes);
          } else {
            debugPrint("Capture Endpoint Error: HTTP ${response.statusCode}");
          }
        } catch (e) {
          debugPrint("Local TFLite Error: $e");
        }

        if (mounted) setState(() => _isLocalAiProcessing = false);
      });

    } else {
      // Online Mode: RTDB Telemetry
      _telemetrySub = _firebaseService.telemetryStream?.listen((data) {
        if (mounted) setState(() {
          _batteryPercentage = data['battery_percentage'] != null ? data['battery_percentage'].toDouble() : null;
          _obstacleDistance = data['obstacle_distance'];
        });
      });

      // Poll Firebase Storage
      _frameTimer = Timer.periodic(const Duration(milliseconds: 3000), (timer) async {
        final url = await _firebaseService.getLiveFrameUrl();
        if (url.isNotEmpty && url != _liveFrameUrl && mounted) {
          setState(() => _liveFrameUrl = url);
        }
      });
    }
  }


  @override
  void dispose() {
    _frameTimer?.cancel();
    _localAiTimer?.cancel();
    _telemetrySub?.cancel();
    _offlineTelemetrySub?.cancel();
    _debounceTimer?.cancel();
    _visionTimer?.cancel();
    _aiCommandController.dispose();
    _offlineService.dispose();
    _wsSub?.cancel();
    _wsChannel?.sink.close();
    super.dispose();
  }

  void _toggleRoverMode(bool isAutonomous) {
    setState(() {
      _currentMode = isAutonomous ? RoverMode.autonomous : RoverMode.manual;
    });

    final modeString = isAutonomous ? "AUTONOMOUS" : "MANUAL";
    _firebaseService.setNavigationMode(modeString);

    if (isAutonomous) {
      _visionTimer?.cancel();
      _visionTimer = Timer.periodic(const Duration(seconds: 3), (timer) async {
        if (!_isAiProcessing && _liveFrameUrl.isNotEmpty) {
          _isAiProcessing = true;
          try {
            final instruction = userInstruction.isNotEmpty 
                ? userInstruction 
                : "Navigate safely and avoid obstacles";
            await AIService().processVisionCommand(instruction, _liveFrameUrl);
          } finally {
            _isAiProcessing = false;
          }
        }
      });
    } else {
      _visionTimer?.cancel();
    }
  }

  // Command Dispatch Helper
  void _sendCommand(String command) {
    _debounceTimer?.cancel();
    _debounceTimer = Timer(const Duration(milliseconds: 50), () {
      if (_wsChannel != null) {
        try {
          _wsChannel!.sink.add('{"mode":"manual","action":"drive","direction":"$command","speed":255}');
          return;
        } catch (e) {
          debugPrint("WS send failed, falling back to HTTP: $e");
        }
      }

      if (_isOfflineMode) {
        _offlineService.sendCommand('drive', command, speed: 255);
      } else {
        _firebaseService.sendCommand('drive', command, speed: 255);
      }
    });
  }

  void _showSettingsDialog() {
    final TextEditingController streamHostController = TextEditingController(text: _localMjpegStream.replaceAll("http://", ""));
    final TextEditingController commandEndpointController = TextEditingController(text: _localCommandHost);

    showDialog(
      context: context,
      builder: (context) {
        return AlertDialog(
          backgroundColor: const Color(0xFF1E293B),
          title: const Text("System Settings", style: TextStyle(color: Colors.white, fontWeight: FontWeight.bold)),
          content: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              TextField(
                controller: streamHostController,
                style: const TextStyle(color: Colors.white),
                decoration: const InputDecoration(
                  labelText: "Stream Host",
                  labelStyle: TextStyle(color: Colors.white70),
                  enabledBorder: UnderlineInputBorder(borderSide: BorderSide(color: Colors.white24)),
                  focusedBorder: UnderlineInputBorder(borderSide: BorderSide(color: Colors.cyan)),
                  hintText: "172.30.43.196:80/stream",
                  hintStyle: TextStyle(color: Colors.white24)
                ),
              ),
              const SizedBox(height: 16),
              TextField(
                controller: commandEndpointController,
                style: const TextStyle(color: Colors.white),
                decoration: const InputDecoration(
                  labelText: "Rover Command Endpoint (HTTP)",
                  labelStyle: TextStyle(color: Colors.white70),
                  enabledBorder: UnderlineInputBorder(borderSide: BorderSide(color: Colors.white24)),
                  focusedBorder: UnderlineInputBorder(borderSide: BorderSide(color: Colors.cyan)),
                  hintText: "172.30.43.196",
                  hintStyle: TextStyle(color: Colors.white24)
                ),
              ),
            ],
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(context),
              child: const Text("Cancel", style: TextStyle(color: Colors.white54)),
            ),
            TextButton(
              onPressed: () {
                String streamHost = streamHostController.text.trim();
                if (!streamHost.startsWith('http://') && !streamHost.startsWith('https://')) {
                  if (streamHost.contains('/')) {
                    streamHost = 'http://$streamHost';
                  } else {
                    streamHost = 'http://$streamHost/stream';
                  }
                }
                String cmdHost = commandEndpointController.text.trim();
                
                String extractedIp = _extractIp(cmdHost.isEmpty ? streamHost : cmdHost);
                if (extractedIp.isEmpty) {
                  extractedIp = _extractIp(streamHost);
                }

                setState(() {
                  _localMjpegStream = streamHost;
                  _localCommandHost = extractedIp;
                });
                _offlineService.setEspUrl(_localCommandHost);
                _connectWebSocket();
                Navigator.pop(context);
              },
              child: const Text("Save", style: TextStyle(color: Colors.cyan, fontWeight: FontWeight.bold)),
            ),
          ],
        );
      },
    );
  }

  void _sendArmCommand() {
    _debounceTimer?.cancel();
    _debounceTimer = Timer(const Duration(milliseconds: 50), () {
      final angles = {
        "base": _baseAngle.toInt(),
        "shoulder": _shoulderAngle.toInt(),
        "elbow": _elbowAngle.toInt(),
        "wrist": _wristAngle.toInt(),
        "gripper": _gripperAngle.toInt(),
      };
      
      final payload = jsonEncode({
        "type": "arm_raw",
        "angles": angles,
        "timestamp": DateTime.now().millisecondsSinceEpoch
      });

      if (!_isOfflineMode) {
        _firebaseService.sendRawJsonCommand(payload);
      }
    });
  }

  // AI Execute Helper
  void _handleAiSubmit([String? voiceInput]) {
    String text = voiceInput ?? _aiCommandController.text.trim();
    if (text.isEmpty) return;
    
    String lowerText = text.toLowerCase();
    
    // Keyword Interceptor
    if (lowerText.contains("autonomous") || lowerText.contains("auto mode") || lowerText.contains("start auto")) {
      _toggleRoverMode(true);
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text("Switched to Autonomous Mode"), behavior: SnackBarBehavior.floating));
      if (voiceInput == null) _aiCommandController.clear();
      return;
    }
    if (lowerText.contains("manual") || lowerText.contains("manual mode") || lowerText.contains("stop auto")) {
      _toggleRoverMode(false);
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text("Switched to Manual Mode"), behavior: SnackBarBehavior.floating));
      if (voiceInput == null) _aiCommandController.clear();
      return;
    }

    if (_currentMode == RoverMode.autonomous) {
      setState(() {
        userInstruction = text;
      });
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text("Autonomous vision target updated successfully."),
          behavior: SnackBarBehavior.floating, // Optimal for both Windows and Mobile scaling
        ),
      );
      if (voiceInput == null) _aiCommandController.clear();
    } else {
      if (voiceInput != null) _aiCommandController.text = text;
      _executeAiScan();
    }
  }

  Future<void> _executeAiScan() async {
    final instruction = _aiCommandController.text.trim();
    if (instruction.isEmpty) return;

    setState(() {
      _isAiProcessing = true;
    });

    await AIService().analyzeSceneAndCommand(instruction);

    if (mounted) {
      setState(() {
        _isAiProcessing = false;
        _aiCommandController.clear();
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    return DefaultTabController(
      length: 3,
      child: Scaffold(
        backgroundColor: const Color(0xFF0B0F19),
        appBar: AppBar(
          title: const Text('ARES-01 DUAL-BRAIN', style: TextStyle(color: Colors.white, fontWeight: FontWeight.bold)),
        backgroundColor: const Color(0xFF1E293B),
        actions: [
          // ROVER MODE TOGGLE
          Row(
            children: [
              Text(_currentMode == RoverMode.autonomous ? "AUTO" : "MANUAL", 
                style: TextStyle(color: _currentMode == RoverMode.autonomous ? Colors.greenAccent : Colors.white70, fontWeight: FontWeight.bold)
              ),
              Switch(
                value: _currentMode == RoverMode.autonomous,
                activeColor: Colors.greenAccent,
                inactiveThumbColor: Colors.grey,
                onChanged: _toggleRoverMode,
              ),
            ],
          ),
          const SizedBox(width: 8),
          
          // OFFLINE MODE TOGGLE
          Row(
            children: [
              Icon(Icons.cloud, color: !_isOfflineMode ? Colors.cyan : Colors.white24, size: 20),
              Switch(
                value: _isOfflineMode,
                activeColor: Colors.amber,
                inactiveThumbColor: Colors.cyan,
                onChanged: _switchMode,
              ),
              Icon(Icons.bolt, color: _isOfflineMode ? Colors.amber : Colors.white24, size: 20),
            ],
          ),
          const SizedBox(width: 8),
          IconButton(
            icon: const Icon(Icons.settings, color: Colors.white70),
            onPressed: _showSettingsDialog,
          ),
          const SizedBox(width: 16),
          _buildTelemetryBadge(
            icon: Icons.battery_charging_full,
            text: _batteryPercentage != null ? '${_batteryPercentage!.toStringAsFixed(1)}%' : '--%',
            color: _batteryPercentage != null ? (_batteryPercentage! > 20 ? Colors.greenAccent : Colors.redAccent) : Colors.grey,
          ),
          const SizedBox(width: 8),
          _buildTelemetryBadge(
            icon: Icons.radar,
            text: '${_obstacleDistance.toStringAsFixed(1)} cm',
            color: _obstacleDistance > 30 ? Colors.greenAccent : (_obstacleDistance > 15 ? Colors.amber : Colors.redAccent),
          ),
          const SizedBox(width: 16),
        ],
      ),
      body: Row(
        children: [
          // LEFT COLUMN: Camera Feed and Proximity
          Expanded(
            flex: 55,
            child: Column(
              children: [
                const Expanded(
                  flex: 2,
                  child: Row(
                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                    crossAxisAlignment: CrossAxisAlignment.end,
                    children: [
                      // Top overlays would go here
                    ],
                  ),
                ),
                Expanded(
                  flex: 6,
                  child: Container(
                    margin: const EdgeInsets.symmetric(horizontal: 8.0),
                    decoration: BoxDecoration(
                      color: Colors.black,
                      borderRadius: BorderRadius.circular(16),
                      border: Border.all(color: Colors.white12, width: 2),
                    ),
                    child: Stack(
                      alignment: Alignment.center,
                      children: [
                        if (!_isOfflineMode && _liveFrameUrl.isEmpty)
                          const Column(
                            mainAxisAlignment: MainAxisAlignment.center,
                            children: [
                              CircularProgressIndicator(color: Colors.cyan),
                              SizedBox(height: 16),
                              Text("Awaiting Firebase ESP32-CAM Feed...", style: TextStyle(color: Colors.white54)),
                            ],
                          )
                        else if (_isOfflineMode)
                          // Offline Mode: Render Local MJPEG stream
                          ClipRRect(
                            borderRadius: BorderRadius.circular(14),
                            child: Image.network(
                              "$_localMjpegStream?t=${DateTime.now().millisecondsSinceEpoch}",
                              fit: BoxFit.cover,
                              gaplessPlayback: false,
                              width: double.infinity,
                              height: double.infinity,
                              loadingBuilder: (context, child, progress) {
                                if (progress == null) return child;
                                return const Center(child: CircularProgressIndicator(color: Colors.amber));
                              },
                              errorBuilder: (context, error, stackTrace) {
                                debugPrint("[ARES-01] Camera stream error at $_localMjpegStream: $error");
                                return const Column(
                                  mainAxisAlignment: MainAxisAlignment.center,
                                  children: [
                                    Icon(Icons.broken_image, size: 64, color: Colors.redAccent),
                                    SizedBox(height: 16),
                                    Text("STREAM ERROR", style: TextStyle(color: Colors.redAccent, fontWeight: FontWeight.bold)),
                                  ],
                                );
                              },
                            ),
                          )
                        else
                          ClipRRect(
                            borderRadius: BorderRadius.circular(14),
                            child: Image.network(
                              "$_liveFrameUrl?t=${DateTime.now().millisecondsSinceEpoch}",
                              key: ValueKey(_liveFrameUrl), 
                              fit: BoxFit.cover,
                              gaplessPlayback: false,
                              width: double.infinity,
                              height: double.infinity,
                              loadingBuilder: (context, child, progress) {
                                if (progress == null) return child;
                                return const Center(child: CircularProgressIndicator(color: Colors.cyan));
                              },
                            ),
                          ),
                        
                      ],
                    ),
                  ),
                ),
                Expanded(
                  flex: 2,
                  child: Row(
                    mainAxisAlignment: MainAxisAlignment.center,
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      if (_obstacleDistance < 100) // Show radar if reasonably close
                        Container(
                          margin: const EdgeInsets.only(top: 16),
                          width: 300,
                          child: ClipRRect(
                            borderRadius: BorderRadius.circular(12),
                            child: BackdropFilter(
                              filter: ImageFilter.blur(sigmaX: 10, sigmaY: 10),
                              child: Container(
                                padding: const EdgeInsets.all(12),
                                decoration: BoxDecoration(
                                  color: Colors.black.withOpacity(0.4),
                                  borderRadius: BorderRadius.circular(12),
                                  border: Border.all(
                                    color: _obstacleDistance < 15 ? Colors.redAccent.withOpacity(0.5) 
                                         : (_obstacleDistance < 30 ? Colors.amber.withOpacity(0.5) : Colors.white12),
                                    width: 1
                                  ),
                                  boxShadow: _obstacleDistance < 15 
                                      ? [BoxShadow(color: Colors.redAccent.withOpacity(0.3), blurRadius: 15, spreadRadius: 2)] 
                                      : [],
                                ),
                                child: Column(
                                  mainAxisSize: MainAxisSize.min,
                                  children: [
                                    Row(
                                      mainAxisAlignment: MainAxisAlignment.spaceBetween,
                                      children: [
                                        const Text("PROXIMITY", style: TextStyle(color: Colors.white70, fontSize: 10, fontWeight: FontWeight.bold, letterSpacing: 2)),
                                        Text(
                                          _obstacleDistance < 15 ? "BRAKE" : "${_obstacleDistance.toStringAsFixed(1)} cm",
                                          style: TextStyle(
                                            color: _obstacleDistance < 15 ? Colors.redAccent 
                                                 : (_obstacleDistance < 30 ? Colors.amber : Colors.greenAccent),
                                            fontSize: 12,
                                            fontWeight: FontWeight.bold,
                                          ),
                                        ),
                                      ],
                                    ),
                                    const SizedBox(height: 8),
                                    Container(
                                      height: 8,
                                      width: double.infinity,
                                      decoration: BoxDecoration(
                                        color: Colors.black54,
                                        borderRadius: BorderRadius.circular(4),
                                        border: Border.all(color: Colors.white10),
                                      ),
                                      alignment: Alignment.centerLeft,
                                      child: LayoutBuilder(
                                        builder: (context, constraints) {
                                          double fillRatio = (100 - _obstacleDistance).clamp(0, 100) / 100.0;
                                          return AnimatedContainer(
                                            duration: const Duration(milliseconds: 300),
                                            width: constraints.maxWidth * fillRatio,
                                            height: double.infinity,
                                            decoration: BoxDecoration(
                                              borderRadius: BorderRadius.circular(4),
                                              gradient: LinearGradient(
                                                colors: _obstacleDistance < 15 
                                                    ? [Colors.redAccent, Colors.red]
                                                    : (_obstacleDistance < 30 ? [Colors.amber, Colors.orange] : [Colors.greenAccent, Colors.green]),
                                              ),
                                              boxShadow: [
                                                BoxShadow(
                                                  color: _obstacleDistance < 15 ? Colors.redAccent.withOpacity(0.8) : Colors.transparent,
                                                  blurRadius: 8,
                                                )
                                              ]
                                            ),
                                          );
                                        },
                                      ),
                                    ),
                                  ],
                                ),
                              ),
                            ),
                          ),
                        ),
                    ],
                  ),
                ),
              ],
            ),
          ),
          
          // RIGHT COLUMN: Tabs and Controls
          Expanded(
            flex: 45,
            child: Column(
              children: [
                const TabBar(
                  indicatorColor: Colors.cyan,
                  labelColor: Colors.cyanAccent,
                  unselectedLabelColor: Colors.white54,
                  tabs: [
                    Tab(icon: Icon(Icons.gamepad), text: "Manual"),
                    Tab(icon: Icon(Icons.psychology), text: "AI"),
                    Tab(icon: Icon(Icons.mic), text: "Voice"),
                  ],
                ),
                Expanded(
                  child: AbsorbPointer(
                    absorbing: _currentMode == RoverMode.autonomous,
                    child: Opacity(
                      opacity: _currentMode == RoverMode.autonomous ? 0.3 : 1.0,
                      child: TabBarView(
                        children: [
                          // Tab 1: Manual Locomotion & Arm
                          Column(
                            children: [
                              const SizedBox(height: 32),
                              Expanded(child: _buildArmControlPanel()),
                              const SizedBox(height: 24),
                              Container(
                                padding: const EdgeInsets.all(8.0),
                                child: Column(
                                  mainAxisAlignment: MainAxisAlignment.center,
                                  children: [
                                    Row(
                                      mainAxisAlignment: MainAxisAlignment.center,
                                      children: [
                                        _buildControlButton(Icons.arrow_upward, () => _sendCommand("FORWARD")),
                                      ],
                                    ),
                                    Row(
                                      mainAxisAlignment: MainAxisAlignment.center,
                                      children: [
                                        _buildControlButton(Icons.arrow_back, () => _sendCommand("LEFT")),
                                        const SizedBox(width: 8),
                                        _buildControlButton(Icons.stop, () => _sendCommand("STOP"), isStop: true),
                                        const SizedBox(width: 8),
                                        _buildControlButton(Icons.arrow_forward, () => _sendCommand("RIGHT")),
                                      ],
                                    ),
                                    Row(
                                      mainAxisAlignment: MainAxisAlignment.center,
                                      children: [
                                        _buildControlButton(Icons.arrow_downward, () => _sendCommand("BACKWARD")),
                                      ],
                                    ),
                                  ],
                                ),
                              ),
                            ],
                          ),
                          // Tab 2: AI Directive
                          _buildAIDirectivePanel(),
                          // Tab 3: Voice Command
                          _buildVoiceCommandPanel(),
                        ],
                      ),
                    ),
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    ));
  }

  Widget _buildAIDirectivePanel() {
    return Container(
      padding: const EdgeInsets.all(16.0),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Card(
            color: Colors.black26,
            child: Padding(
              padding: const EdgeInsets.symmetric(horizontal: 12.0, vertical: 12.0),
              child: Column(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  Row(
                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                    children: [
                      const Text("AI DIRECTIVITY ☁️", style: TextStyle(color: Colors.cyanAccent, fontWeight: FontWeight.bold, fontSize: 14)),
                      _buildModeToggle(),
                    ],
                  ),
                  const SizedBox(height: 12),
                  Row(
                    children: [
                      Expanded(
                        child: TextField(
                          controller: _aiCommandController,
                          style: const TextStyle(color: Colors.white, fontSize: 14),
                          decoration: InputDecoration(
                            hintText: "e.g., 'Find the red object'",
                            hintStyle: const TextStyle(color: Colors.white30),
                            filled: true,
                            fillColor: Colors.black12,
                            border: OutlineInputBorder(borderRadius: BorderRadius.circular(8), borderSide: BorderSide.none),
                            contentPadding: const EdgeInsets.symmetric(horizontal: 12, vertical: 12),
                          ),
                          onSubmitted: (_) => _handleAiSubmit(),
                        ),
                      ),
                      const SizedBox(width: 12),
                      GestureDetector(
                        onTap: _isAiProcessing ? null : () => _handleAiSubmit(),
                        child: Container(
                          padding: const EdgeInsets.all(14),
                          decoration: BoxDecoration(color: Colors.cyan, borderRadius: BorderRadius.circular(8)),
                          child: _isAiProcessing 
                            ? const SizedBox(width: 20, height: 20, child: CircularProgressIndicator(color: Colors.white, strokeWidth: 2)) 
                            : const Icon(Icons.psychology, color: Colors.black, size: 24),
                        ),
                      )
                    ],
                  )
                ],
              ),
            ),
          ),
          const SizedBox(height: 16),
          Expanded(
            child: Card(
              color: Colors.black45,
              child: Padding(
                padding: const EdgeInsets.all(12.0),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    const Text("CONSOLE LOG", style: TextStyle(color: Colors.white54, fontSize: 12, fontWeight: FontWeight.bold)),
                    const Divider(color: Colors.white24),
                    Expanded(
                      child: SingleChildScrollView(
                        child: Text(
                          _isOfflineMode ? "System initialized offline. Awaiting input..." : "Connected to Cloud AI.",
                          style: const TextStyle(color: Colors.greenAccent, fontFamily: 'monospace', fontSize: 12),
                        ),
                      ),
                    ),
                  ],
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildVoiceCommandPanel() {
    return Container(
      padding: const EdgeInsets.all(16.0),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Card(
            color: Colors.black26,
            child: Padding(
              padding: const EdgeInsets.symmetric(horizontal: 12.0, vertical: 16.0),
              child: Column(
                mainAxisAlignment: MainAxisAlignment.center,
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  const Row(
                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                    children: [
                      Text("VOICE COMMAND 🎤", style: TextStyle(color: Colors.greenAccent, fontWeight: FontWeight.bold, fontSize: 14)),
                    ],
                  ),
                  const SizedBox(height: 16),
                  ElevatedButton.icon(
                    style: ElevatedButton.styleFrom(
                      backgroundColor: Colors.white12,
                      padding: const EdgeInsets.symmetric(vertical: 24),
                      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8)),
                    ),
                    onPressed: () {
                      // Simulating a voice keyword interception for testing
                      _handleAiSubmit("start auto");
                    },
                    icon: const Icon(Icons.mic, color: Colors.white, size: 32),
                    label: const Text("Hold to Speak", style: TextStyle(color: Colors.white, fontSize: 18)),
                  )
                ],
              ),
            ),
          ),
          const SizedBox(height: 16),
          Expanded(
            child: Card(
              color: Colors.black45,
              child: Padding(
                padding: const EdgeInsets.all(12.0),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    const Text("CONSOLE LOG", style: TextStyle(color: Colors.white54, fontSize: 12, fontWeight: FontWeight.bold)),
                    const Divider(color: Colors.white24),
                    Expanded(
                      child: SingleChildScrollView(
                        child: Text(
                          "Audio System Active. Ready for commands.",
                          style: const TextStyle(color: Colors.cyanAccent, fontFamily: 'monospace', fontSize: 12),
                        ),
                      ),
                    ),
                  ],
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildArmControlPanel() {
    return SingleChildScrollView(
      padding: const EdgeInsets.symmetric(horizontal: 16.0, vertical: 8.0),
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          _buildJointSlider("Base", _baseAngle, "[<- LEFT]", "[RIGHT ->]", 
            (val) => setState(() { _baseAngle = val; _sendArmCommand(); }), 
            (val) => _sendArmCommand()
          ),
          _buildJointSlider("Shoulder", _shoulderAngle, "[<- DOWN]", "[UP ->]", 
            (val) => setState(() { _shoulderAngle = val; _sendArmCommand(); }), 
            (val) => _sendArmCommand()
          ),
          _buildJointSlider("Elbow", _elbowAngle, "[<- DOWN]", "[UP ->]", 
            (val) => setState(() { _elbowAngle = val; _sendArmCommand(); }), 
            (val) => _sendArmCommand()
          ),
          _buildJointSlider("Wrist", _wristAngle, "[<- DOWN]", "[UP ->]", 
            (val) => setState(() { _wristAngle = val; _sendArmCommand(); }), 
            (val) => _sendArmCommand()
          ),
          _buildJointSlider("Gripper", _gripperAngle, "[<- OPEN]", "[CLOSE ->]", 
            (val) => setState(() { _gripperAngle = val; _sendArmCommand(); }), 
            (val) => _sendArmCommand()
          ),
        ],
      ),
    );
  }

  Widget _buildJointSlider(String name, double value, String leftLabel, String rightLabel, ValueChanged<double> onChanged, ValueChanged<double> onChangeEnd) {
    return Column(
      children: [
        Row(
          children: [
            SizedBox(width: 70, child: Text(name, style: const TextStyle(color: Colors.white70, fontSize: 13))),
            Text("[$leftLabel]", style: TextStyle(color: value < 90 ? Colors.redAccent : Colors.white30, fontSize: 10, fontWeight: FontWeight.bold)),
            Expanded(
              child: Slider(
                value: value,
                min: 0,
                max: 180,
                divisions: 180,
                activeColor: value == 90 ? Colors.cyan : (value > 90 ? Colors.greenAccent : Colors.redAccent),
                inactiveColor: Colors.white24,
                onChanged: onChanged,
                onChangeEnd: onChangeEnd,
              ),
            ),
            Text("[$rightLabel]", style: TextStyle(color: value > 90 ? Colors.greenAccent : Colors.white30, fontSize: 10, fontWeight: FontWeight.bold)),
            SizedBox(width: 32, child: Text(
              value > 90 ? "  ↑" : (value < 90 ? "  ↓" : "  -"),
              style: TextStyle(
                color: value == 90 ? Colors.cyanAccent : (value > 90 ? Colors.greenAccent : Colors.redAccent),
                fontSize: 16,
                fontWeight: FontWeight.bold
              ),
              textAlign: TextAlign.right,
            )),
          ],
        ),
        const SizedBox(height: 12),
      ],
    );
  }

  Widget _buildControlButton(IconData icon, VoidCallback onPressed, {bool isStop = false}) {
    return GestureDetector(
      onTapDown: (_) => onPressed(),
      onTapUp: (_) { if (!isStop) _sendCommand("STOP"); }, // Auto-stop on release for safety
      child: Container(
        width: 64,
        height: 64,
        decoration: BoxDecoration(
          color: isStop ? Colors.redAccent.withOpacity(0.2) : Colors.white12,
          shape: BoxShape.circle,
          border: Border.all(color: isStop ? Colors.redAccent : Colors.white24, width: 2),
        ),
        child: Icon(icon, color: isStop ? Colors.redAccent : Colors.white, size: 32),
      ),
    );
  }

  Widget _buildTelemetryBadge({required IconData icon, required String text, required Color color}) {
    return ClipRRect(
      borderRadius: BorderRadius.circular(12),
      child: BackdropFilter(
        filter: ImageFilter.blur(sigmaX: 10, sigmaY: 10),
        child: AnimatedContainer(
          duration: const Duration(milliseconds: 300),
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
          decoration: BoxDecoration(
            color: Colors.black.withOpacity(0.4),
            border: Border.all(color: color.withOpacity(0.4), width: 1),
            borderRadius: BorderRadius.circular(12),
            boxShadow: [
              BoxShadow(color: color.withOpacity(0.15), blurRadius: 10, spreadRadius: 1)
            ],
          ),
          child: Row(
            children: [
              Icon(icon, color: color, size: 16),
              const SizedBox(width: 8),
              Text(text, style: TextStyle(color: Colors.white, fontWeight: FontWeight.bold, fontSize: 13, letterSpacing: 1)),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildModeToggle() {
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        Text("MANUAL", style: TextStyle(fontSize: 10, color: _currentMode == RoverMode.manual ? Colors.white : Colors.white30)),
        Switch(
          value: _currentMode == RoverMode.autonomous,
          onChanged: _toggleRoverMode,
          activeColor: Colors.greenAccent,
          inactiveThumbColor: Colors.grey,
        ),
        Text("AUTO", style: TextStyle(fontSize: 10, color: _currentMode == RoverMode.autonomous ? Colors.greenAccent : Colors.white30)),
      ],
    );
  }
}
