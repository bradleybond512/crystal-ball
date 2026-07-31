import unittest

from tools.agentic_pipeline.github import GitHubClient


class GitHubClientTests(unittest.TestCase):
    def test_pr_body_update_replaces_pipeline_section_idempotently(self):
        calls = []

        def runner(command, **kwargs):
            calls.append((command, kwargs))
            if command[:3] == ["gh", "pr", "view"]:
                return type(
                    "Result",
                    (),
                    {
                        "returncode": 0,
                        "stdout": '{"body":"Intro\\n\\n<!-- agentic-pipeline:start -->\\nold\\n'
                        '<!-- agentic-pipeline:end -->\\n","isDraft":true}',
                        "stderr": "",
                    },
                )()
            return type(
                "Result",
                (),
                {"returncode": 0, "stdout": "", "stderr": ""},
            )()

        client = GitHubClient("owner/repo", runner=runner)

        client.update_pr_body(12, "new validation")

        edit = calls[-1]
        self.assertEqual(edit[0][:3], ["gh", "pr", "edit"])
        body = edit[1]["input"]
        self.assertEqual(body.count("<!-- agentic-pipeline:start -->"), 1)
        self.assertIn("new validation", body)
        self.assertNotIn("\nold\n", body)

    def test_refuses_non_draft_pr(self):
        def runner(*_args, **_kwargs):
            return type(
                "Result",
                (),
                {
                    "returncode": 0,
                    "stdout": '{"body":"Intro","isDraft":false}',
                    "stderr": "",
                },
            )()

        with self.assertRaises(PermissionError):
            GitHubClient("owner/repo", runner=runner).update_pr_body(12, "summary")


if __name__ == "__main__":
    unittest.main()
