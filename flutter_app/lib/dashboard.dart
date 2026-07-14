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
  final String _localMjpegStream = "http://192.168.4.1:80";
  bool _isLocalAiProcessing = false;
  Timer? _localAiTimer;
  
  // AI Commander State
  final TextEditingController _aiCommandController = TextEditingController();
  bool _isAiProcessing = false;

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
          final response = await http.get(Uri.parse('http://192.168.4.1/capture'));
          
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
      _frameTimer = Timer.periodic(const Duration(milliseconds: 500), (timer) async {
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
      _visionTimer = Timer.periodic(const Duration(seconds: 3), (timer) {
        if (_liveFrameUrl.isNotEmpty) {
          final instruction = _aiCommandController.text.trim().isNotEmpty 
              ? _aiCommandController.text.trim() 
              : "Navigate safely and avoid obstacles";
          AIService().processVisionCommand(instruction, _liveFrameUrl);
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
                    // Offline Mode: Render Local MJPEG or static Image for demo
                    // Since Flutter Web/Native handles MJPEG poorly without complex plugins, 
                    // a placeholder image or a custom stream parser is used here.
                    const Column(
                      mainAxisAlignment: MainAxisAlignment.center,
                      children: [
                        Icon(Icons.wifi_tethering, size: 64, color: Colors.amber),
                        SizedBox(height: 16),
                        Text("LOCAL AP STREAM ACTIVE", style: TextStyle(color: Colors.amber, fontWeight: FontWeight.bold)),
                        Text("IP: 192.168.4.1", style: TextStyle(color: Colors.white54)),
                      ],
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
          
          // AI COMMANDER
          Expanded(
            flex: 1,
            child: Container(
              padding: const EdgeInsets.symmetric(horizontal: 24.0, vertical: 8.0),
              decoration: const BoxDecoration(
                border: Border(top: BorderSide(color: Colors.white12, width: 1)),
                color: Color(0xFF1E293B),
              ),
              child: Column(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  Text(
                    _isOfflineMode ? "OFFLINE TFLITE EDGE ⚡" : "AI COMMANDER ☁️", 
                    style: TextStyle(
                      color: _isOfflineMode ? Colors.amber : Colors.cyanAccent, 
                      letterSpacing: 2, 
                      fontWeight: FontWeight.bold
                    )
                  ),
                  const SizedBox(height: 12),
                  if (_isOfflineMode)
                    // Offline UI
                    Row(
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
                  else
                    // Online UI
                    Row(
                      children: [
                        Expanded(
                          child: TextField(
                            controller: _aiCommandController,
                            style: const TextStyle(color: Colors.white),
                            decoration: InputDecoration(
                              hintText: "e.g., 'Find the red object and approach it'",
                              hintStyle: const TextStyle(color: Colors.white30),
                              filled: true,
                              fillColor: Colors.black26,
                              border: OutlineInputBorder(
                                borderRadius: BorderRadius.circular(8),
                                borderSide: BorderSide.none,
                              ),
                            ),
                            onSubmitted: (_) => _executeAiScan(),
                          ),
                        ),
                        const SizedBox(width: 12),
                        GestureDetector(
                          onTap: _isAiProcessing ? null : _executeAiScan,
                          child: AnimatedContainer(
                            duration: const Duration(milliseconds: 300),
                            padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 16),
                            decoration: BoxDecoration(
                              color: _isAiProcessing ? Colors.cyan.withOpacity(0.5) : Colors.cyan,
                              borderRadius: BorderRadius.circular(8),
                              boxShadow: _isAiProcessing 
                                ? [BoxShadow(color: Colors.cyanAccent.withOpacity(0.8), blurRadius: 15, spreadRadius: 2)] 
                                : [],
                            ),
                            child: _isAiProcessing 
                              ? const SizedBox(
                                  width: 20, height: 20, 
                                  child: CircularProgressIndicator(color: Colors.white, strokeWidth: 2)
                                )
                              : const Icon(Icons.psychology, color: Colors.black, size: 24),
                          ),
                        )
                      ],
                    ),
                ],
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
}
