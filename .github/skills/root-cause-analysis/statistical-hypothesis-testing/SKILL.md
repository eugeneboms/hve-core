---
name: statistical-hypothesis-testing
description: 'Compare binary rates or average values across independent evidence groups during root cause analysis.'
compatibility: "Requires an Agent Skills host and a statistical runtime supporting Barnard's exact test and Welch's independent-samples t-test."
---

# Statistical Hypothesis Testing

## Goal

Test whether binary evidence rates or average observation values differ between supporting and
contradicting groups during a root cause investigation.

## Inputs

* One independent row per observational unit, such as a server, resource, tenant, process run,
  transaction, batch, location, participant, or incident instance
* Group status: supporting or contradicting the hypothesis, such as affected or unaffected
* One consistently defined observation: binary presence or absence, or a finite numeric value
* Source, query, UTC window, scope, exclusions, and sampling limitations

Do not continue if instances are duplicated, dependent, selected after inspecting the outcome, or
classified differently between groups. Record the test as `Blocked` until corrected. Choose the
test from the observation type before inspecting the result.

## Binary Rate Test

Let $n_0$ be contradicting instances, $c_0$ contradicting instances with evidence, $n_1$ be
supporting instances, and $k$ be supporting instances with evidence.

Model the groups as two independent binomial samples:

$$
X_1 \sim \operatorname{Binomial}(n_1,p_1)
\qquad\text{and}\qquad
X_0 \sim \operatorname{Binomial}(n_0,p_0)
$$

Test $H_0: p_1 = p_0$ against $H_A: p_1 \ne p_0$ with Barnard's exact test, an unconditional
two-sample binomial test for the $2 \times 2$ table:

|                     | Evidence present | Evidence absent |
|---------------------|-----------------:|----------------:|
| Supporting group    |              $k$ |         $n_1-k$ |
| Contradicting group |            $c_0$ |       $n_0-c_0$ |

Use an available statistical runtime, such as
`scipy.stats.barnard_exact([[k, n1 - k], [c0, n0 - c0]], alternative="two-sided")`.
Report the returned score statistic and p-value. Do not substitute Fisher's exact test, a
one-sample binomial test, or a normal approximation.

If either group is empty, record the test as `Blocked`. Report small group sizes, sparse cells,
and rates of 0 or 1 prominently because they limit precision even when the exact test executes.

## Average Value Test

For a finite numeric observation whose average has operational meaning, let the supporting group
have values $x_1,\ldots,x_{n_1}$ and the contradicting group have values
$y_1,\ldots,y_{n_0}$. Define the hypotheses before execution:

$$
H_0: \mu_1 = \mu_0
\qquad\text{and}\qquad
H_A: \mu_1 \ne \mu_0
$$

Use Welch's two-sided independent-samples t-test, which does not assume equal variances:
`scipy.stats.ttest_ind(supporting, contradicting, equal_var=False, alternative="two-sided")`.
Report both group means, standard deviations, sample sizes, the mean difference
$\bar{x}-\bar{y}$, its 95% Welch confidence interval, the test statistic, degrees of freedom, and
p-value.

Do not use this test for paired, repeated, censored, infinite, or non-independent observations.
Record it as `Blocked` until the dependence or data-quality problem is resolved. Inspect group
distributions for severe skew and influential outliers. If either group is too small to estimate
variance, or those features make a mean-based model unreliable, report the limitation and do not
claim the test distinguishes the hypothesis.

Before querying any source, verify the subject, schema, time semantics, observation window,
independent-unit key, source lineage, units, sampling, filtering, and collection coverage.
Aggregate to one observation per independent unit before testing.

In Azure SRE mode, sources can include Azure Monitor, Log Analytics, Application Insights, and
Azure Data Explorer. Use the Azure resource, table, event-time field, UTC window, instance key,
sampling, and ingestion checks as authoritative source requirements for those observations.

## Interpretation

For binary evidence, report $k/n_1$, $c_0/n_0$, their difference, the two-sample exact score
statistic and p-value, and both sample sizes. For numeric evidence, report the average-value
results specified above. A p-value is the probability, under $H_0$, of an outcome at least as
incompatible with the null model as the observation. It is not the probability that the RCA
hypothesis is true, an effect-size measure, or causal proof.

Do not convert the result directly into `Supported` or `Disproved`. Return it to `root-cause-analysis` as one discriminating test alongside mechanism evidence, contradictions, controls, and coverage limitations. If multiple evidence signals are tested, disclose the number and avoid selecting only the smallest p-value.

## RCA Record

Return:

* `Test T-nnn`: hypothesis ID; supporting and contradicting group definitions; observation rule and
  units; executed query, command, comparison, or collection procedure and parameters; applicable
  absolute window; selected test and parameters; execution status; limitations
* `Evidence E-nnn`: source and locator; binary counts and rates, or numeric sample sizes, means,
  standard deviations, mean difference, and confidence interval; test statistic and p-value;
  collection time; coverage, lineage, transformation, and redaction notes
* Conclusion: inconsistent or not demonstrably inconsistent with the contradicting-group baseline,
  without claiming causality
