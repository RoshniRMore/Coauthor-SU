import importlib.util
from pathlib import Path
import unittest

import numpy as np

spec = importlib.util.spec_from_file_location("coauthor_app", Path(__file__).resolve().parents[1] / "streamlit_app/app.py")
app = importlib.util.module_from_spec(spec)
spec.loader.exec_module(app)


class QueryExplanationTests(unittest.TestCase):
    def test_query_changes_publication_and_theme_using_lexical_cache(self):
        person = {"name": "Researcher", "publications": ["a", "b"]}
        papers = {"a": {"id": "a", "title": "Climate Paper"}, "b": {"id": "b", "title": "Health Paper"}}
        index = {
            "vectors": {"publications": {"a": [0, 1], "b": [1, 0]}},
            "fallback": {"vectors": {"publications": {"a": [1, 0], "b": [0, 1]}}},
            "themes": [
                {"name": "Climate", "representative_publications": ["a"]},
                {"name": "Health", "representative_publications": ["b"]},
            ],
            "explanations": {"person": "Stale global theme explanation"},
        }
        for vector, title, name in [([1, 0], "Climate Paper", "Climate"), ([0, 1], "Health Paper", "Health")]:
            query = np.array(vector)
            theme = index["themes"][int(np.argmax(app.query_theme_scores(query, index)))]
            reason = app.match_explanation(query, person, papers, index, theme)
            self.assertIn(f'“{title}”', reason)
            self.assertTrue(reason.endswith(f"the {name} theme."))
        self.assertEqual(app.match_explanation(np.array([1, 0]), {**person, "publications": []}, papers, index, theme),
                         "No publication evidence is available for this query.")


if __name__ == "__main__":
    unittest.main()
