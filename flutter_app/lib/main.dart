import 'package:flutter/material.dart';
import 'package:flutter_inappwebview/flutter_inappwebview.dart';
import 'package:flutter/foundation.dart' show kIsWeb;
import 'dart:io' show Platform;
import 'package:permission_handler/permission_handler.dart';

void main() {
  runApp(const RoverApp());
}

class RoverApp extends StatelessWidget {
  const RoverApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'ARES-01',
      debugShowCheckedModeBanner: false,
      theme: ThemeData(
        primaryColor: Colors.blueGrey[900],
        useMaterial3: true,
      ),
      home: const RoverDashboard(),
    );
  }
}

class RoverDashboard extends StatefulWidget {
  const RoverDashboard({super.key});

  @override
  State<RoverDashboard> createState() => _RoverDashboardState();
}

class _RoverDashboardState extends State<RoverDashboard> {
  bool _isWebViewSupported = true;

  // TODO: Replace this placeholder with my actual Antigravity 2.0 web app URL or IP address.
  final String _roverWebAppUrl = "http://192.168.0.24:5173"; 

  @override
  void initState() {
    super.initState();
    _checkPlatformCompatibility();
    _requestPermissions();
  }

  Future<void> _requestPermissions() async {
    if (!kIsWeb && (Platform.isAndroid || Platform.isIOS)) {
      await [Permission.microphone, Permission.camera].request();
    }
  }

  void _checkPlatformCompatibility() {
    // Verifying if the app is running on a Windows desktop environment.
    if (!kIsWeb && Platform.isWindows) {
      setState(() {
        _isWebViewSupported = false;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text(
          'ARES-01',
          style: TextStyle(color: Colors.white, fontWeight: FontWeight.bold),
        ),
        backgroundColor: Colors.blueGrey[900],
        elevation: 4,
      ),
      body: SafeArea(
        // Render the stable InAppWebView for Mobile, or fallback UI for Windows desktop.
        child: _isWebViewSupported
            ? InAppWebView(
                initialUrlRequest: URLRequest(
                  url: WebUri(_roverWebAppUrl),
                ),
                initialSettings: InAppWebViewSettings(
                  javaScriptEnabled: true,
                  domStorageEnabled: true,
                  databaseEnabled: true,
                  mixedContentMode: MixedContentMode.MIXED_CONTENT_ALWAYS_ALLOW,
                  supportZoom: false,
                  builtInZoomControls: false,
                  mediaPlaybackRequiresUserGesture: false,
                  allowsInlineMediaPlayback: true,
                  iframeAllow: "camera; microphone",
                ),
                onPermissionRequest: (controller, request) async {
                  return PermissionResponse(
                    resources: request.resources,
                    action: PermissionResponseAction.GRANT,
                  );
                },
              )
            : _buildWindowsFallbackUI(),
      ),
    );
  }

  Widget _buildWindowsFallbackUI() {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(24.0),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            const Icon(Icons.laptop_windows_rounded, size: 100, color: Colors.blueGrey),
            const SizedBox(height: 24),
            const Text(
              'Windows Environment Ready',
              style: TextStyle(fontSize: 24, fontWeight: FontWeight.bold),
            ),
            const SizedBox(height: 12),
            const Text(
              'WebView rendering is configured for mobile environments.\n'
              'I need to compile and run this project on an Android device to interface with the Rover.',
              textAlign: TextAlign.center,
              style: TextStyle(color: Colors.grey, fontSize: 16, height: 1.5),
            ),
            const SizedBox(height: 32),
            ElevatedButton.icon(
              onPressed: () {
                debugPrint('Action triggered: Attempting to open $_roverWebAppUrl externally.');
              },
              icon: const Icon(Icons.open_in_browser),
              label: const Text('Launch Externally'),
              style: ElevatedButton.styleFrom(
                padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 12),
                textStyle: const TextStyle(fontSize: 16),
              ),
            )
          ],
        ),
      ),
    );
  }
}