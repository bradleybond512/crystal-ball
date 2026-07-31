import unittest

from tools.agentic_pipeline.redaction import Redactor


class RedactorTests(unittest.TestCase):
    def test_redacts_common_credentials_without_erasing_safe_context(self):
        text = (
            "Authorization: Bearer sk-secretvalue\n"
            "OPENAI_API_KEY=abc123secret\n"
            "https://user:password@example.com/path\n"
            "safe failure detail"
        )

        redacted = Redactor().redact(text)

        self.assertNotIn("sk-secretvalue", redacted)
        self.assertNotIn("abc123secret", redacted)
        self.assertNotIn("password", redacted)
        self.assertIn("safe failure detail", redacted)
        self.assertGreaterEqual(redacted.count("[REDACTED]"), 3)

    def test_redacts_nested_serializable_values(self):
        value = {"stderr": ["GITHUB_TOKEN=topsecret"], "count": 2}

        self.assertEqual(
            Redactor().redact_value(value),
            {"stderr": ["GITHUB_TOKEN=[REDACTED]"], "count": 2},
        )

    def test_redacts_github_app_tokens_and_json_secret_values(self):
        text = (
            'GH_TOKEN=ghs_1234567890 '
            '"api_key": "sk-1234567890" '
            '"password":"do-not-log-this"'
        )

        redacted = Redactor().redact(text)

        self.assertNotIn("ghs_1234567890", redacted)
        self.assertNotIn("sk-1234567890", redacted)
        self.assertNotIn("do-not-log-this", redacted)


if __name__ == "__main__":
    unittest.main()
