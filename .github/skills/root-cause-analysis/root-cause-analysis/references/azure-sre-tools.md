---
description: Azure SRE host detection signals and read-only tool catalog for the root-cause-analysis skill
---

# Azure SRE Tool Catalog

Read this reference only after `root-cause-analysis` selects Azure SRE mode. Tool names describe
host capabilities; they do not grant access, change approval boundaries, or require an unrelated
tool call.

## Detection

Treat explicit Azure SRE Agent host identity as authoritative. When identity is not explicit, the
presence of a distinctive tool such as `GetAnalysis`, `SearchIncidentKnowledge`, or
`ExecuteClusterKustoQuery` is sufficient. General Azure tools that can appear in other hosts do
not establish Azure SRE mode by themselves.

## Use

Inspect the tools actually exposed by the host. Automatically invoke every relevant, safe,
read-only tool that can materially answer the current scope question, validate source coverage,
or discriminate between active hypotheses. Skip unavailable, unrelated, duplicative, write-capable,
or evidence-altering tools. Follow the RCA production-action approval boundary even when a listed
tool can perform a broader action.

## Catalog

### Azure resource and connectivity

* `CheckIfResourceExists`
* `CheckTcpConnectivity`
* `GetAllAzureDataFactoryPipelinesStatus`
* `GetAllAzureFrontDoorEndpointOriginsStatus`
* `GetAppSetting`
* `GetArmResourceAsJson`
* `GetAzCliHelp`
* `GetTlsSettings`
* `RunAzCliReadCommands`
* `WaitInMilliSeconds`

### Repository and work tracking

* `FetchGithubIssue`
* `FetchGithubIssueComments`
* `FetchGithubIssues`
* `FetchGithubSecurityDependabotAlerts`
* `FindConnectedGitHubRepo`
* `FindConnectedRepositoryForAzureDevOps`
* `GetIaCForGitHub`
* `GetUserOrganizations`

### Investigation and change history

* `GetAnalysis`
* `GetTaskExecutionHistory`
* `ListScheduledTasks`
* `AnalyzeDeploymentFailures`
* `GetActivityLogsSummary`
* `GetChangeHistory`
* `SearchIncidentKnowledge`
* `SearchMemory`
* `ShowChangeDiffViewer`

### Logs, metrics, and queries

* `ExecuteClusterKustoQuery`
* `GetMetricTimeSeriesElementsForAzureResource`
* `KustoClient`
* `ListAvailableMetrics`
* `QueryAppInsightsByAppId`
* `QueryAppInsightsByResourceId`
* `QueryLogAnalyticsByResourceId`
* `QueryLogAnalyticsByWorkspaceId`
* `ValidateQuery`
* `GetDimensionNames`

### Pipelines and builds

* `CompareRuns`
* `CompareWithLastSuccessfulRun`
* `DiscoverPipelinesForRepo`
* `GetBuildDetails`
* `GetBuildTimeline`
* `GetPipelineRunHistory`
* `GetPipelineRunStatus`
* `GetTaskLogExcerpt`
* `InvestigateBuildFailure`

### Time, visualization, and reports

* `GetCurrentUtcTime`
* `PlotAreaChartWithCorrelation`
* `PlotBarChart`
* `PlotHeatmap`
* `PlotPieChart`
* `PlotScatter`
* `GenerateRunDiffReport`

### Azure Monitor MCP

* `system-mcp-monitor_monitor_activitylog_list`
* `system-mcp-monitor_monitor_healthmodels_entity_get`
* `system-mcp-monitor_monitor_instrumentation_get-learning-resource`
* `system-mcp-monitor_monitor_metrics_definitions`
* `system-mcp-monitor_monitor_metrics_query`
* `system-mcp-monitor_monitor_resource_log_query`
* `system-mcp-monitor_monitor_table_list`
* `system-mcp-monitor_monitor_table_type_list`
* `system-mcp-monitor_monitor_webtests_get`
* `system-mcp-monitor_monitor_workspace_list`
* `system-mcp-monitor_monitor_workspace_log_query`
