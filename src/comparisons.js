import { BUDGET, DEFAULT_VALUES, createRun, mean, setLink, stepRun } from './model.js';

/** Five deterministic cases; all use the same gain and 1,000-update budget. */
export function compareScenarios() {
  const scenarios = [
    { id: 'complete', label: 'Complete graph', preset: 'complete' },
    { id: 'chain', label: 'Chain', preset: 'chain' },
    { id: 'groups', label: 'Two groups', preset: 'groups' },
    { id: 'recovery', label: 'Chain: cut at 0, reconnect at 100', preset: 'chain' },
    { id: 'shifted', label: 'Complete graph: all values +100', preset: 'complete', values: DEFAULT_VALUES.map((value) => value + 100) },
  ];
  return scenarios.map(({ id, label, preset, values }) => {
    let run = createRun({ preset, values });
    if (id === 'recovery') run = setLink(run, 2, 3, false);
    while (run.step < BUDGET) {
      if (id === 'recovery' && run.step === 100) run = setLink(run, 2, 3, true);
      run = stepRun(run);
    }
    return {
      id,
      label,
      initialValues: run.initial.values,
      initialMean: mean(run.initial.values),
      firstAgreementStep: run.firstAgreementStep,
      exchangesToAgreement: run.firstAgreementStep === null ? null : run.history[run.firstAgreementStep].exchanges,
      finalStep: run.step,
      finalDisagreement: run.history.at(-1).disagreement,
      totalExchanges: run.exchanges,
      finalValues: run.values,
      events: run.events,
    };
  });
}
