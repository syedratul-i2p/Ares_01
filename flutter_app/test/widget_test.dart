import 'package:flutter_test/flutter_test.dart';
import 'package:rover_control_app/main.dart';

void main() {
  testWidgets('Rover Control Center smoke test', (WidgetTester tester) async {
    // Build our app and trigger a frame.
    await tester.pumpWidget(const AresDualBrainApp());

    // Verify that the title 'ARES-01 DUAL-BRAIN' is displayed.
    expect(find.text('ARES-01 DUAL-BRAIN'), findsOneWidget);
  });
}
