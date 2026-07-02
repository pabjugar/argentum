defmodule ArenaWeb.SpaController do
  use ArenaWeb, :controller

  def index(conn, _params) do
    conn
    |> put_resp_header("content-type", "text/html; charset=utf-8")
    |> send_file(200, index_path())
  end

  # En el contenedor el cliente vive en $ARGENTUM_PROJECT_ROOT/client/dist; en dev
  # el server corre desde server/ y el cliente está en ../client.
  defp index_path do
    case System.get_env("ARGENTUM_PROJECT_ROOT") do
      nil -> Path.expand("../client/dist/index.html", File.cwd!())
      root -> Path.join(root, "client/dist/index.html")
    end
  end
end
