import 'dart:convert';
import 'package:flutter/foundation.dart';
import 'package:http/http.dart' as http;
import 'package:flutter_dotenv/flutter_dotenv.dart';
import 'firebase_service.dart';

class AIService {
  static final AIService _instance = AIService._internal();
  factory AIService() => _instance;
  AIService._internal();

  bool _isInitialized = false;
  late String _apiKey;

  Future<void> initialize() async {
    if (_isInitialized) return;
    
    // Secure API key loading
    final key = dotenv.env['GROQ_API_KEY'];
    if (key == null || key.isEmpty || key == 'YOUR_GROQ_API_KEY_HERE') {
      debugPrint('[AIService] API Key not found in .env file.');
      return;
    }

    _apiKey = key;
    _isInitialized = true;
    debugPrint('[AIService] Groq LPU API Initialized.');
  }

  /// Master function for Phase 3:
  /// 1. Prompts Groq llama-3.1-8b-instant with user instruction
  /// 2. Passes resulting raw JSON directly to Firebase RTDB Command Node
  Future<void> analyzeSceneAndCommand(String userInstruction) async {
    if (!_isInitialized) {
      debugPrint('[AIService] Cannot execute, AI Service not initialized.');
      return;
    }

    try {
      debugPrint('[AIService] Sending instruction to Groq Cloud...');
      
      final systemPrompt = '''
You are the central autonomous brain for the ARES-01 Rover. 
Fulfill the user instruction based on your capabilities.

Rules:
1. You MUST respond with ONLY a raw JSON payload representing the action sequence.
2. The JSON payload MUST strictly match the following nested array format. Do NOT use markdown formatting (no ```json).

OUTPUT FORMAT:
{
  "actions": [
    { "type": "drive", "command": "FORWARD", "speed": 200 },
    { "type": "arm_macro", "command": "PICKUP" }
  ],
  "summary": "Brief analysis description"
}
''';

      final response = await http.post(
        Uri.parse('https://api.groq.com/openai/v1/chat/completions'),
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer $_apiKey',
        },
        body: jsonEncode({
          'model': 'llama-3.1-8b-instant',
          'messages': [
            {'role': 'system', 'content': systemPrompt},
            {'role': 'user', 'content': 'User Instruction: "$userInstruction"'}
          ],
          'response_format': {'type': 'json_object'},
          'temperature': 0.1,
          'max_tokens': 256,
        }),
      );

      if (response.statusCode != 200) {
        debugPrint('[AIService] Groq API Error: ${response.statusCode} - ${response.body}');
        return;
      }

      try {
        final data = jsonDecode(response.body);
        final choices = data['choices'] as List<dynamic>?;
        
        if (choices == null || choices.isEmpty) {
          debugPrint('[AIService] API Response missing choices payload.');
          return;
        }

        final rawContent = choices[0]['message']?['content']?.trim() ?? '{}';
        debugPrint('[AIService] Groq AI Response: $rawContent');

        final parsed = jsonDecode(rawContent);
        final actions = parsed['actions'] as List<dynamic>? ?? [];
        
        for (final action in actions) {
          final actionJson = jsonEncode(action);
          await FirebaseService().sendRawJsonCommand(actionJson);
          await Future.delayed(const Duration(milliseconds: 100));
        }
      } on FormatException catch (e) {
        debugPrint('[AIService] JSON FormatException: ${e.message}');
      } catch (e) {
        debugPrint('[AIService] Unexpected payload extraction error: $e');
      }
      
    } catch (e) {
      debugPrint('[AIService] Analysis Failed: $e');
    }
  }

  /// Process multimodal vision commands via Groq Llama 3.2 Vision
  Future<void> processVisionCommand(String userInstruction, String imageUrl) async {
    if (!_isInitialized) {
      debugPrint('[AIService] Cannot execute vision command, AI Service not initialized.');
      return;
    }

    try {
      debugPrint('[AIService] Sending multimodal instruction to Groq Cloud Vision...');
      
      final systemPrompt = '''
You are the central autonomous brain for the ARES-01 Rover. 
Fulfill the user instruction based on your visual capabilities.

Rules:
1. You MUST respond with ONLY a raw JSON payload representing the action sequence.
2. The JSON payload MUST strictly match the following nested array format. Do NOT use markdown formatting (no ```json).

OUTPUT FORMAT:
{
  "actions": [
    { "type": "autonomous", "command": "FORWARD", "speed": 200 }
  ],
  "summary": "Visual path description"
}
''';

      final response = await http.post(
        Uri.parse('https://api.groq.com/openai/v1/chat/completions'),
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer $_apiKey',
        },
        body: jsonEncode({
          'model': 'llama-3.2-11b-vision-preview',
          'messages': [
            {'role': 'system', 'content': systemPrompt},
            {
              'role': 'user', 
              'content': [
                {'type': 'text', 'text': 'User Instruction: "$userInstruction"'},
                {'type': 'image_url', 'image_url': {'url': imageUrl}}
              ]
            }
          ],
          'response_format': {'type': 'json_object'},
          'temperature': 0.1,
          'max_tokens': 256,
        }),
      );

      if (response.statusCode != 200) {
        debugPrint('[AIService] Groq Vision API Error: ${response.statusCode} - ${response.body}');
        return;
      }

      try {
        final data = jsonDecode(response.body);
        final choices = data['choices'] as List<dynamic>?;
        
        if (choices == null || choices.isEmpty) {
          debugPrint('[AIService] Vision API Response missing choices payload.');
          return;
        }

        final rawContent = choices[0]['message']?['content']?.trim() ?? '{}';
        debugPrint('[AIService] Groq Vision AI Response: $rawContent');

        final parsed = jsonDecode(rawContent);
        final actions = parsed['actions'] as List<dynamic>? ?? [];
        
        for (final action in actions) {
          final actionJson = jsonEncode(action);
          await FirebaseService().sendRawJsonCommand(actionJson);
          // Safe 50ms debouncer transmission interval
          await Future.delayed(const Duration(milliseconds: 50));
        }
      } on FormatException catch (e) {
        debugPrint('[AIService] Vision JSON FormatException: ${e.message}');
      } catch (e) {
        debugPrint('[AIService] Unexpected vision payload extraction error: $e');
      }
      
    } catch (e) {
      debugPrint('[AIService] Vision Analysis Failed: $e');
    }
  }
}
