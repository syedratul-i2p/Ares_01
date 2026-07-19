import 'dart:async';
import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;
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

  double _batteryPercentage = 0.0;
  double _obstacleDistance = 999.9;
  
  // Arm State
  double _baseAngle = 90;
  double _shoulderAngle = 90;
  double _elbowAngle = 90;
  double _wristAngle = 90;
  double _gripperAngle = 0;

  String _liveFrameUrl = "";
  Timer? _frameTimer;
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
          _batteryPercentage = data['battery_percentage'];
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
          _batteryPercentage = data['battery_percentage'];
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
      if (_isOfflineMode) {
        _offlineService.sendCommand('drive', command, speed: 200);
      } else {
        _firebaseService.sendCommand('drive', command, speed: 200);
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
                setState(() {
                  _localMjpegStream = "http://${streamHostController.text.trim()}";
                  _localCommandHost = commandEndpointController.text.trim();
                });
                _offlineService.setEspUrl(_localCommandHost);
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
      length: 2,
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
            text: '${_batteryPercentage.toStringAsFixed(1)}%',
            color: _batteryPercentage > 20 ? Colors.greenAccent : Colors.redAccent,
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
      body: Column(
        children: [
          // LIVE FRAME VIEWER
          Expanded(
            flex: 2,
            child: Container(
              margin: const EdgeInsets.all(16.0),
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
                    // Offline Mode: Render Local MJPEG stream from ESP32 via HTTP REST
                    ClipRRect(
                      borderRadius: BorderRadius.circular(14),
                      child: Image.network(
                        _localMjpegStream,
                        key: ValueKey(_localMjpegStream), 
                        fit: BoxFit.contain,
                        width: double.infinity,
                        height: double.infinity,
                        loadingBuilder: (context, child, progress) {
                          if (progress == null) return child;
                          return const Center(child: CircularProgressIndicator(color: Colors.amber));
                        },
                        errorBuilder: (context, error, stackTrace) {
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
                        _liveFrameUrl,
                        key: ValueKey(_liveFrameUrl), 
                        fit: BoxFit.contain,
                        width: double.infinity,
                        height: double.infinity,
                        loadingBuilder: (context, child, progress) {
                          if (progress == null) return child;
                          return const Center(child: CircularProgressIndicator(color: Colors.cyan));
                        },
                      ),
                    ),
                  
                  // Auto-Brake Overlay Warning
                  if (_obstacleDistance < 15.0)
                    Container(
                      color: Colors.redAccent.withOpacity(0.3),
                      alignment: Alignment.center,
                      child: const Text(
                        "AUTO-BRAKE ENGAGED",
                        style: TextStyle(color: Colors.white, fontSize: 32, fontWeight: FontWeight.bold, letterSpacing: 4),
                      ),
                    )
                ],
              ),
            ),
          ),

          const TabBar(
            indicatorColor: Colors.cyan,
            labelColor: Colors.cyanAccent,
            unselectedLabelColor: Colors.white54,
            tabs: [
              Tab(icon: Icon(Icons.gamepad), text: "Locomotion"),
              Tab(icon: Icon(Icons.precision_manufacturing), text: "Robotic Arm"),
            ],
          ),
          
          Expanded(
            flex: 2,
            child: AbsorbPointer(
              absorbing: _currentMode == RoverMode.autonomous,
              child: Opacity(
                opacity: _currentMode == RoverMode.autonomous ? 0.3 : 1.0,
                child: TabBarView(
                  children: [
                    // Locomotion DPad
                    Container(
                  padding: const EdgeInsets.all(16.0),
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
                
                // Robotic Arm Control Panel
                _buildArmControlPanel(),
              ],
            ),
              ),
            ),
          ),
          
          // AI DIRECTIVITY & VOICE COMMAND
          Expanded(
            flex: 1,
            child: Container(
              padding: const EdgeInsets.symmetric(horizontal: 16.0, vertical: 8.0),
              decoration: const BoxDecoration(
                border: Border(top: BorderSide(color: Colors.white12, width: 1)),
                color: Color(0xFF1E293B),
              ),
              child: _isOfflineMode 
                ? Row(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                      const Icon(Icons.memory, color: Colors.amber, size: 28),
                      const SizedBox(width: 12),
                      Text(
                        _isLocalAiProcessing ? "Processing Frames..." : "TFLite Active",
                        style: const TextStyle(color: Colors.white, fontSize: 16),
                      ),
                      if (_isLocalAiProcessing)
                        const Padding(
                          padding: EdgeInsets.only(left: 12),
                          child: SizedBox(width: 16, height: 16, child: CircularProgressIndicator(color: Colors.amber, strokeWidth: 2)),
                        )
                    ],
                  )
                : LayoutBuilder(
                    builder: (context, constraints) {
                      bool isWide = constraints.maxWidth > 600;
                      return Row(
                        crossAxisAlignment: CrossAxisAlignment.stretch,
                        children: [
                          // AI DIRECTIVITY CARD
                          Expanded(
                            flex: isWide ? 1 : 2,
                            child: Card(
                              color: Colors.black26,
                              child: Padding(
                                padding: const EdgeInsets.symmetric(horizontal: 12.0, vertical: 4.0),
                                child: Column(
                                  mainAxisAlignment: MainAxisAlignment.center,
                                  children: [
                                    Row(
                                      mainAxisAlignment: MainAxisAlignment.spaceBetween,
                                      children: [
                                        const Text("AI DIRECTIVITY ☁️", style: TextStyle(color: Colors.cyanAccent, fontWeight: FontWeight.bold, fontSize: 12)),
                                        _buildModeToggle(),
                                      ],
                                    ),
                                    const SizedBox(height: 4),
                                    Row(
                                      children: [
                                        Expanded(
                                          child: TextField(
                                            controller: _aiCommandController,
                                            style: const TextStyle(color: Colors.white, fontSize: 12),
                                            decoration: InputDecoration(
                                              hintText: "e.g., 'Find the red object'",
                                              hintStyle: const TextStyle(color: Colors.white30),
                                              filled: true,
                                              fillColor: Colors.black12,
                                              border: OutlineInputBorder(borderRadius: BorderRadius.circular(8), borderSide: BorderSide.none),
                                              contentPadding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                                            ),
                                            onSubmitted: (_) => _handleAiSubmit(),
                                          ),
                                        ),
                                        const SizedBox(width: 8),
                                        GestureDetector(
                                          onTap: _isAiProcessing ? null : () => _handleAiSubmit(),
                                          child: Container(
                                            padding: const EdgeInsets.all(10),
                                            decoration: BoxDecoration(color: Colors.cyan, borderRadius: BorderRadius.circular(8)),
                                            child: _isAiProcessing 
                                              ? const SizedBox(width: 16, height: 16, child: CircularProgressIndicator(color: Colors.white, strokeWidth: 2)) 
                                              : const Icon(Icons.psychology, color: Colors.black, size: 20),
                                          ),
                                        )
                                      ],
                                    )
                                  ],
                                ),
                              ),
                            ),
                          ),
                          if (isWide) const SizedBox(width: 8),
                          // VOICE COMMAND CARD
                          Expanded(
                            flex: 1,
                            child: Card(
                              color: Colors.black26,
                              child: Padding(
                                padding: const EdgeInsets.symmetric(horizontal: 12.0, vertical: 4.0),
                                child: Column(
                                  mainAxisAlignment: MainAxisAlignment.center,
                                  crossAxisAlignment: CrossAxisAlignment.stretch,
                                  children: [
                                    Row(
                                      mainAxisAlignment: MainAxisAlignment.spaceBetween,
                                      children: [
                                        const Text("VOICE COMMAND 🎤", style: TextStyle(color: Colors.greenAccent, fontWeight: FontWeight.bold, fontSize: 12)),
                                        if (isWide) _buildModeToggle(),
                                      ],
                                    ),
                                    const SizedBox(height: 4),
                                    ElevatedButton.icon(
                                      style: ElevatedButton.styleFrom(
                                        backgroundColor: Colors.white12,
                                        padding: const EdgeInsets.symmetric(vertical: 12),
                                        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8)),
                                      ),
                                      onPressed: () {
                                        // Simulating a voice keyword interception for testing
                                        _handleAiSubmit("start auto");
                                      },
                                      icon: const Icon(Icons.mic, color: Colors.white, size: 20),
                                      label: const Text("Hold to Speak", style: TextStyle(color: Colors.white, fontSize: 12)),
                                    )
                                  ],
                                ),
                              ),
                            ),
                          ),
                        ],
                      );
                    },
                  ),
            ),
          )
        ],
      ),
    ));
  }

  Widget _buildArmControlPanel() {
    return SingleChildScrollView(
      padding: const EdgeInsets.symmetric(horizontal: 16.0, vertical: 8.0),
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          _buildJointSlider("Base", _baseAngle, (val) => setState(() { _baseAngle = val; _sendArmCommand(); })),
          _buildJointSlider("Shoulder", _shoulderAngle, (val) => setState(() { _shoulderAngle = val; _sendArmCommand(); })),
          _buildJointSlider("Elbow", _elbowAngle, (val) => setState(() { _elbowAngle = val; _sendArmCommand(); })),
          _buildJointSlider("Wrist", _wristAngle, (val) => setState(() { _wristAngle = val; _sendArmCommand(); })),
          _buildJointSlider("Gripper", _gripperAngle, (val) => setState(() { _gripperAngle = val; _sendArmCommand(); })),
        ],
      ),
    );
  }

  Widget _buildJointSlider(String name, double value, ValueChanged<double> onChanged) {
    return Row(
      children: [
        SizedBox(width: 75, child: Text(name, style: const TextStyle(color: Colors.white70, fontSize: 13))),
        Expanded(
          child: Slider(
            value: value,
            min: 0,
            max: 180,
            divisions: 180,
            activeColor: Colors.cyan,
            inactiveColor: Colors.white24,
            onChanged: onChanged,
          ),
        ),
        SizedBox(width: 32, child: Text("${value.toInt()}°", style: const TextStyle(color: Colors.cyanAccent, fontSize: 13))),
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
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
      decoration: BoxDecoration(
        color: color.withOpacity(0.1),
        border: Border.all(color: color.withOpacity(0.3)),
        borderRadius: BorderRadius.circular(20),
      ),
      child: Row(
        children: [
          Icon(icon, color: color, size: 16),
          const SizedBox(width: 6),
          Text(text, style: TextStyle(color: color, fontWeight: FontWeight.bold, fontSize: 12)),
        ],
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
