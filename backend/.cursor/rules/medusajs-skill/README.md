# medusajs-skill

Agent skill for **MedusaJS v2** backend work: modules, workflows, Store/Admin APIs, deployment, and operations.

## Install

### Cursor (project)

```bash
cp -R medusajs-skill /path/to/your/project/.cursor/rules/medusajs-skill
```

### Universal

```bash
cp -R medusajs-skill ~/.agents/skills/medusajs-skill
```

Or run `./install.sh` from this directory (see `--help`).

## Use

In chat, invoke:

```text
/medusajs-skill How do I add a custom admin API route that runs a workflow?
```

## Optional helper

```bash
python3 scripts/medusa_layout_check.py /path/to/medusa-backend
```

Prints JSON describing whether the folder looks like a Medusa v2 project.

## License

MIT (same as agent-skill-creator factory output).
