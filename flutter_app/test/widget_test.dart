import 'package:flutter_test/flutter_test.dart';
import 'package:rover_control_app/main.dart';

void main() {
  testWidgets('Rover Control Center smoke test', (WidgetTester tester) async {
    // Build our app and trigger a frame.
    await tester.pumpWidget(const RoverApp());

    // Verify that the title 'Rover Control Center' is displayed.
    expect(find.text('Rover Control Center'), findsOneWidget);
  });
}
