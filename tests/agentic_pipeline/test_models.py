import unittest

from tools.agentic_pipeline.models import (
    BudgetExceeded,
    BudgetLedger,
    BudgetLimits,
    FailurePacket,
    PipelineState,
    PipelineStatus,
    TokenUsage,
)


class BudgetLedgerTests(unittest.TestCase):
    def test_reports_remaining_tokens_before_an_invocation(self):
        ledger = BudgetLedger(
            limits=BudgetLimits(
                max_total_tokens=100,
                max_invocations=3,
                max_tokens_per_invocation=40,
            ),
            input_tokens=30,
            output_tokens=20,
        )

        self.assertEqual(ledger.remaining_tokens, 50)
        self.assertEqual(ledger.invocation_token_limit, 40)

    def test_rejects_usage_that_exceeds_token_budget(self):
        ledger = BudgetLedger(limits=BudgetLimits(max_total_tokens=100, max_invocations=3))

        ledger.reserve_invocation()

        with self.assertRaises(BudgetExceeded):
            ledger.record(TokenUsage(input_tokens=70, output_tokens=31))

    def test_requires_pricing_when_cost_budget_is_enabled(self):
        ledger = BudgetLedger(
            limits=BudgetLimits(max_total_tokens=1_000, max_invocations=3, max_cost_usd=1.0)
        )

        with self.assertRaises(BudgetExceeded):
            ledger.record(TokenUsage(input_tokens=10, output_tokens=10))

    def test_calculates_and_enforces_reported_cost(self):
        ledger = BudgetLedger(
            limits=BudgetLimits(max_total_tokens=1_000, max_invocations=3, max_cost_usd=0.5)
        )

        ledger.record(TokenUsage(input_tokens=10, output_tokens=10, cost_usd=0.4))

        with self.assertRaises(BudgetExceeded):
            ledger.record(TokenUsage(input_tokens=1, output_tokens=1, cost_usd=0.11))


class PipelineModelTests(unittest.TestCase):
    def test_pipeline_state_round_trips_failure_packet(self):
        state = PipelineState.new(
            request="Repair provider parsing",
            request_hash="hash",
            budget=BudgetLimits(max_total_tokens=1_000, max_invocations=4),
            branch="codex/feature",
            baseline_sha="abc123",
            control_sha="def456",
        )
        state.status = PipelineStatus.BLOCKED
        state.last_failure = FailurePacket(
            builder="provider_engineer",
            failure_class="test",
            command=["npm", "run", "test:providers"],
            exit_code=1,
            summary="provider test failed",
            relevant_output="token=[REDACTED]",
            changed_files=["src/services/providers/example.ts"],
            attempt=2,
        )

        restored = PipelineState.from_dict(state.to_dict())

        self.assertEqual(restored, state)


if __name__ == "__main__":
    unittest.main()
