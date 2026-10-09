import typer

app = typer.Typer()


@app.command()
def generate_readme() -> None:
    """Generate README.md from docs/index.md."""
    open("README.md", "w").write("generated")


@app.command()
def render_banner() -> None:
    print("banner")
