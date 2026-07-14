import 'package:flutter/material.dart';
import 'package:firebase_core/firebase_core.dart';
import 'package:flutter_dotenv/flutter_dotenv.dart';
import 'dashboard.dart';
import 'firebase_options.dart';

void main() async {
  WidgetsFlutterBinding.ensureInitialized();
  
  // Load API Keys
  await dotenv.load(fileName: ".env");
  
  // 1. Firebase Init (Supports Windows, Android, iOS based on flutterfire config)
  try {
    await Firebase.initializeApp(
      options: DefaultFirebaseOptions.currentPlatform,
    );
  } catch (e) {
    debugPrint("Firebase Init Warning (Make sure flutterfire configure was run): $e");
  }
  
  runApp(const AresDualBrainApp());
}

class AresDualBrainApp extends StatelessWidget {
  const AresDualBrainApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'ARES-01 Dual Brain',
      debugShowCheckedModeBanner: false,
      theme: ThemeData.dark().copyWith(
        primaryColor: const Color(0xFF0B0F19),
        scaffoldBackgroundColor: const Color(0xFF0B0F19),
        useMaterial3: true,
      ),
      // 2. Load the Native Firebase Bridge UI Dashboard
      home: const DualBrainDashboard(),
    );
  }
}