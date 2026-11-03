# SAP Asset Performance Management indicator read adapter

**Status:** implemented and deterministic-test proven; not certified against a
customer APM subaccount. Capability-register item C2.19 remains partial. This
adapter confirms indicator identity. It does not read or write indicator
measurements.

## What was verified

SAP Asset Performance Management is a BTP SaaS. SAP's own extension guidance
states that APM publishes OData, REST and GraphQL APIs, that Asset Health
covers indicators, timeseries and notifications, and that Asset Strategy is
mainly GraphQL. Every call needs an OAuth bearer obtained from the service
key's client credentials and an `X-API-Key`.

The indicator read verified from SAP Learning ("Implementing IoT Integration")
is:

```text
GET https://{apm-host}/IndicatorService/v1/Indicators?$filter=technicalObject_number eq '217100092'
```

That is a REST resource using an OData-style `$filter`. It is not an S/4HANA
OData V2 service under `/sap/opu/odata/sap/`. The same lesson says the
indicator result supplies `SSID`, `technicalObjectType`,
`technicalObjectNumber`, `categoryName`, `positionID` and
`characteristicsInternalId`, and that `value` and `time` belong to the
Timeseries API. The Timeseries example in that lesson is `POST`, returning
`201 Created`. This adapter never calls it.

The SAP samples indicator migration body uses underscore names
(`technicalObject_number`, `technicalObject_type`,
`characteristics_characteristicsInternalId`, `positionDetails_ID`,
`category_name`). The mapper accepts either documented spelling and refuses a
response that is neither an OData V4 `value` collection nor an OData V2
`d.results` collection. The Business Accelerator Hub response example was
behind SAP ID sign-in, so the collection envelope was not copied from the hub
page. A third envelope fails closed.

## Contract

One connector binds one technical object number to one same-tenant site and
1–40 indicator identities to active canonical sensors on the asset whose
`external_id` is that technical object number.

```text
connectors → service-attested connector_runs → ingest_staging → sensors.source_system → ingest_watermarks
```

The only canonical write is `sensors.source_system`, and only when that column
is still null. `last_value`, limits, unit, registry status and
`condition_readings` stay untouched. No health score is calculated.
`asset_health_monitoring` is not used; the platform's condition series is
`condition_readings`, and this API does not supply a reading. An absent
approved indicator is refused rather than treated as healthy. An indicator
that includes `value`, `time` or `values` is refused so an unverified
measurement cannot be promoted.

## Protected runtime configuration

- `SAP_APM_INDICATOR_READ_ALLOWED_HOSTS`: comma-separated exact hostnames.
- `SAP_APM_INDICATOR_READ_CREDENTIALS_JSON`: opaque registry. The bearer is
  the same `oauth_bearer` shape as the other SAP adapters. The API key stays
  in that secret too:

  ```json
  {
    "vault://customer/sap-apm-indicators": {
      "type": "oauth_bearer",
      "access_token": "REDACTED",
      "api_key": "REDACTED"
    }
  }
  ```

The adapter does not call the APM token endpoint and does not guess one. A
named human administrator records the service root ending in
`IndicatorService/v1`, the technical object, the sensor bindings and the
opaque credential reference in `/integrations`. `ai_admin` cannot configure
or enable the source.

## Runtime controls

- The first request sends only the documented `$filter`. It does not send
  `$select`, `$top` or `$orderby`, because those options were not in the
  verified example.
- `@odata.nextLink` or `d.__next` must stay on the same HTTPS origin and
  `/Indicators` path, preserve `$filter`, and add only `$top`, `$skip` or
  `$skiptoken`. Repeated URLs are refused.
- Page, total byte and time ceilings match the other SAP read adapters
  (10 MB, 25 MB, 55 seconds).
- A SHA-256 contract binds tenant, endpoint, credential reference, technical
  object, bindings and ceilings. A mid-flight change fails closed.
- Direct client run creation is trigger-blocked. A watermark advances only
  for a complete zero-reject confirmation.

This function is not on the production deploy allowlist because the deployment
workflow was not changed.

## Live acceptance required before green

1. Dry-run confirms every bound indicator without writing a run, sensor
   source, staging row or watermark.
2. The first committed pull sets `sensors.source_system` only for sensors
   that had no source, and leaves limits and `last_value` exact.
3. A second pull is duplicate evidence.
4. A missing binding, an extra indicator, a measurement payload, a foreign
   sensor and an expired credential fail closed.
5. SAP or APM audit evidence shows no POST, PATCH, PUT or DELETE from SyncAI.

## References

- SAP Learning, Managing SAP Asset Performance Management, "Implementing IoT
  Integration": IndicatorService GET and Timeseries POST.
- SAP Community, "Extending SAP Asset Performance Management: Consume Standard
  API": OAuth client credentials, `X-API-Key`, and the OData/REST/GraphQL
  split.
- SAP samples `apm-migration-tools` `docs/indicator-migration.md`: underscore
  field names on the indicator body.
