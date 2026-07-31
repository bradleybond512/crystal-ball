import unittest

from tools.agentic_pipeline.policy import PlanPolicy


class PlanPolicyTests(unittest.TestCase):
    def test_accepts_only_changed_files_allowed_by_plan(self):
        policy = PlanPolicy(
            {
                "tasks": [
                    {
                        "allowed_files": [
                            "src/providers/**",
                            "tests/provider.test.ts",
                        ]
                    }
                ],
                "approval_gates": [],
            }
        )

        self.assertEqual(
            policy.out_of_scope(
                ["src/providers/acme.ts", "tests/provider.test.ts"]
            ),
            [],
        )
        self.assertEqual(
            policy.out_of_scope(
                ["src/providers/acme.ts", ".github/workflows/release.yml"]
            ),
            [".github/workflows/release.yml"],
        )

    def test_rejects_traversal_and_empty_allowed_file_patterns(self):
        for pattern in ("", "../outside", "/absolute/path", "C:\\outside"):
            with self.subTest(pattern=pattern):
                with self.assertRaises(ValueError):
                    PlanPolicy(
                        {
                            "tasks": [{"allowed_files": [pattern]}],
                            "approval_gates": [],
                        }
                    )

    def test_control_plane_changes_require_explicit_approval(self):
        policy = PlanPolicy(
            {
                "tasks": [{"allowed_files": [".github/workflows/**"]}],
                "approval_gates": ["control_plane"],
            }
        )

        self.assertEqual(policy.pending_gates(set()), ["control_plane"])
        self.assertEqual(policy.pending_gates({"control_plane"}), [])


if __name__ == "__main__":
    unittest.main()
