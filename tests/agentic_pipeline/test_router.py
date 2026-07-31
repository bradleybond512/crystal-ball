import json
import tempfile
import unittest
from pathlib import Path

from tools.agentic_pipeline.router import AgentRouter


class AgentRouterTests(unittest.TestCase):
    def test_focused_work_uses_terra_for_plan_build_and_review(self):
        root = Path(__file__).resolve().parents[2]

        route = AgentRouter(root).route("Add a provider health parser")

        self.assertEqual(route.tier, "focused")
        self.assertEqual(route.planner.agent, "delivery_planner")
        self.assertEqual(route.planner.model, "gpt-5.6-terra")
        self.assertEqual(route.builder.agent, "provider_engineer")
        self.assertEqual(route.builder.model, "gpt-5.6-terra")
        self.assertEqual(route.reviewer.agent, "independent_reviewer")
        self.assertEqual(route.reviewer.model, "gpt-5.6-terra")

    def test_high_assurance_uses_sol_for_judgment_and_terra_for_building(self):
        root = Path(__file__).resolve().parents[2]

        route = AgentRouter(root).route(
            "Change correlation causal architecture"
        )

        self.assertEqual(route.tier, "high_assurance")
        self.assertEqual(route.planner.model, "gpt-5.6-sol")
        self.assertEqual(route.builder.agent, "correlation_engineer")
        self.assertEqual(route.builder.model, "gpt-5.6-terra")
        self.assertEqual(route.builder.effort, "high")
        self.assertEqual(route.reviewer.model, "gpt-5.6-sol")

    def test_coupled_multi_domain_work_uses_one_integration_owner(self):
        root = Path(__file__).resolve().parents[2]

        route = AgentRouter(root).route("Add a provider UI panel")

        self.assertEqual(route.tier, "standard")
        self.assertEqual(route.builder.agent, "integration_engineer")
        self.assertEqual(route.builder.model, "gpt-5.6-terra")
        self.assertEqual(route.builder.effort, "high")

    def test_assigns_models_from_existing_policy(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            (root / ".codex").mkdir()
            (root / ".codex/model-policy.json").write_text(
                json.dumps(
                    {
                        "defaults": {"maxAutomaticRepairs": 2},
                        "agents": {
                            "architect": {"model": "gpt-5.6-sol", "effort": "high"},
                            "provider_engineer": {
                                "model": "gpt-5.6-terra",
                                "effort": "medium",
                            },
                            "independent_reviewer": {
                                "model": "gpt-5.6-sol",
                                "effort": "high",
                            },
                        },
                    }
                )
            )

            def runner(command, **_kwargs):
                self.assertEqual(command[:2], ["node", "scripts/agent-router.mjs"])
                return type(
                    "Result",
                    (),
                    {
                        "returncode": 0,
                        "stdout": json.dumps(
                            {
                                "tier": "high_assurance",
                                "agents": [
                                    "architect",
                                    "provider_engineer",
                                    "independent_reviewer",
                                ],
                                "targeted_checks": ["npm run test:providers"],
                                "always_run": ["npm run lint:ci"],
                                "human_design_approval": True,
                                "rationale": ["provider_engineer"],
                            }
                        ),
                        "stderr": "",
                    },
                )()

            route = AgentRouter(root, runner=runner).route("Add a provider")

        self.assertEqual(route.builder.agent, "provider_engineer")
        self.assertEqual(route.builder.model, "gpt-5.6-terra")
        self.assertEqual(route.planner.model, "gpt-5.6-sol")
        self.assertEqual(route.reviewer.agent, "independent_reviewer")
        self.assertEqual(route.reviewer.model, "gpt-5.6-sol")
        self.assertTrue(route.requires_model_review)
        self.assertTrue(route.requires_design_approval)
        self.assertEqual(route.max_automatic_repairs, 2)
        self.assertEqual(
            route.validation_commands,
            [
                ["npm", "run", "test:providers"],
                ["bash", "scripts/agentic-validate.sh"],
            ],
        )

    def test_rejects_unknown_agent_from_router_output(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            (root / ".codex").mkdir()
            (root / ".codex/model-policy.json").write_text(
                json.dumps({"defaults": {}, "agents": {}})
            )

            def runner(*_args, **_kwargs):
                return type(
                    "Result",
                    (),
                    {
                        "returncode": 0,
                        "stdout": json.dumps(
                            {
                                "tier": "focused",
                                "agents": ["invented_agent"],
                                "targeted_checks": [],
                                "always_run": [],
                                "human_design_approval": False,
                                "rationale": [],
                            }
                        ),
                        "stderr": "",
                    },
                )()

            with self.assertRaises(ValueError):
                AgentRouter(root, runner=runner).route("do work")

    def test_mechanical_route_uses_luna_and_skips_model_review(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            (root / ".codex").mkdir()
            (root / ".codex/model-policy.json").write_text(
                json.dumps(
                    {
                        "defaults": {"maxAutomaticRepairs": 1},
                        "agents": {
                            "mechanical_engineer": {
                                "model": "gpt-5.6-luna",
                                "effort": "low",
                            },
                            "independent_reviewer": {
                                "model": "gpt-5.6-sol",
                                "effort": "high",
                            },
                        },
                    }
                )
            )

            def runner(*_args, **_kwargs):
                return type(
                    "Result",
                    (),
                    {
                        "returncode": 0,
                        "stdout": json.dumps(
                            {
                                "tier": "mechanical",
                                "agents": ["mechanical_engineer"],
                                "targeted_checks": [],
                                "always_run": [],
                                "human_design_approval": False,
                                "rationale": ["mechanical"],
                            }
                        ),
                        "stderr": "",
                    },
                )()

            route = AgentRouter(root, runner=runner).route(
                "Fix typo in README"
            )

        self.assertEqual(route.planner.agent, "mechanical_engineer")
        self.assertEqual(route.builder.agent, "mechanical_engineer")
        self.assertEqual(route.planner.model, "gpt-5.6-luna")
        self.assertFalse(route.requires_model_review)
        self.assertEqual(
            route.validation_commands,
            [["bash", "scripts/agentic-check-mechanical.sh"]],
        )


if __name__ == "__main__":
    unittest.main()
