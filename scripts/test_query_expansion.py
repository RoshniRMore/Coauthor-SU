"""Offline integration tests; API output is simulated, the index is real."""
import importlib.util
import io
import json
import os
from pathlib import Path
import unittest
from unittest.mock import patch

from streamlit.testing.v1 import AppTest

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("expansion_app", ROOT / "streamlit_app/app.py")
app = importlib.util.module_from_spec(spec)
spec.loader.exec_module(app)

EXPANSION = (
    "Global warming research examines climate change driven by anthropogenic "
    "greenhouse gas emissions, atmospheric carbon dioxide, and radiative forcing. "
    "Studies investigate rising global temperatures, ocean warming, precipitation "
    "changes, and impacts on ecosystems, alongside climate mitigation and adaptation."
)


def response(text=EXPANSION):
    return io.BytesIO(json.dumps({
        "status": "completed", "output": [{"type": "message", "content": [
            {"type": "output_text", "text": text}]}],
    }).encode())


class ExpansionTests(unittest.TestCase):
    def setUp(self):
        app.expand_query.clear()

    def test_cache_and_raw_input(self):
        with patch.dict(os.environ, {"OPENAI_API_KEY": "test-key"}), patch.object(
            app, "urlopen", return_value=response()
        ) as request:
            self.assertEqual(app.expand_query("Global Warming"), EXPANSION)
            self.assertEqual(app.expand_query("Global Warming"), EXPANSION)
            self.assertEqual(request.call_count, 1)
            body = json.loads(request.call_args.args[0].data)
            self.assertEqual(body["input"], "Global Warming")

    def test_failures_fall_back_and_can_retry(self):
        with patch.dict(os.environ, {"OPENAI_API_KEY": "test-key"}), patch.object(
            app, "urlopen", side_effect=[TimeoutError(), response("") , response()]
        ):
            for _ in range(2):
                text, warning = app.matching_text("Global Warming")
                self.assertEqual(text, "Global Warming")
                self.assertTrue(warning)
            self.assertEqual(app.matching_text("Global Warming"), (EXPANSION, None))

    def test_missing_key(self):
        with patch.dict(os.environ, {"OPENAI_API_KEY": ""}), patch.object(
            app.st, "secrets", {}
        ), patch.object(app, "urlopen") as request:
            text, warning = app.matching_text("Global Warming")
            self.assertEqual(text, "Global Warming")
            self.assertTrue(warning)
            request.assert_not_called()

    def test_student_flow_climate_and_sparse_guard(self):
        with patch.dict(os.environ, {"OPENAI_API_KEY": "test-key"}), patch(
            "urllib.request.urlopen", side_effect=lambda *args, **kwargs: response()
        ) as request:
            ui = AppTest.from_file(str(ROOT / "streamlit_app/app.py"), default_timeout=60)
            ui.session_state["navigation"] = "Student"
            ui.session_state["idea"] = "Global Warming"
            ui.run()
            self.assertFalse(ui.exception)
            placement = ui.success[0].value
            print("Simulated expansion, real index:", placement)
            self.assertRegex(placement.lower(), "climate|environment")
            self.assertTrue(any(x.label == "View expanded idea" for x in ui.expander))
            self.assertTrue(any(x.value == EXPANSION for x in ui.markdown))
            calls = request.call_count
            ui.run()
            self.assertEqual(request.call_count, calls)
        with patch.dict(os.environ, {"OPENAI_API_KEY": ""}), patch(
            "streamlit.secrets", {}
        ):
            ui.text_area[0].set_value("zzzzzzunknown")
            next(b for b in ui.button if b.label == "Find where this idea fits").click()
            ui.run()
            self.assertFalse(ui.exception)
            self.assertFalse(ui.success)
            self.assertTrue(any(x.value == "That's too short to place confidently — try describing it in a full sentence"
                                for x in ui.warning))
            self.assertTrue(any("original text" in x.value for x in ui.warning))


if __name__ == "__main__":
    unittest.main()
