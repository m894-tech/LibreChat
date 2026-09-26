# Design Workspace

Optional LibreChat module for editable canvas/page layouts, versions, brands, and design systems.

## Enable

Off by default. Set exactly:

```bash
M894_DESIGN_WORKSPACE=1
```

When off:

- `GET /api/design/*` is not mounted (or returns 404)
- Design UI and sidebar entry stay hidden (`interface.design` is false)
- No design Mongo indexes or runtime are created

When on:

- Authenticated routes under `/api/design`
- UI at `/design` when startup config reports `interface.design: true`

## Optional config

| Variable | Purpose |
|---|---|
| `M894_DESIGN_ASSET_DIR` | Asset storage directory (defaults inside the design runtime) |
| `M894_DESIGN_GENERATION=1` | Enable optional text/image generation adapters |
| `M894_DESIGN_PROVIDER_URL` | Generation provider base URL |
| `M894_DESIGN_PROVIDER_ORIGINS` | Comma-separated allowed origins |
| `M894_DESIGN_PROVIDER_MODEL` | Text model id |
| `M894_DESIGN_IMAGE_MODEL` | Image model id |
| `M894_DESIGN_PROVIDER_API_KEY` | Provider API key (env-based; not per-user vault) |
| `M894_DESIGN_MONTHLY_UNITS` | Monthly generation budget |
| `M894_DESIGN_REQUEST_UNITS` | Units per generation request |

## Not included (R2+)

Refero research, inpaint/outpaint, PPTX/office raster export, approval workflows, and Presenton presentation send are **not** ported. Those routes respond with:

```json
{ "error": "not_implemented", "feature": "<name>" }
```

HTTP status `501`.
