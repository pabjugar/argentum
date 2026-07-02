import Config

##########################
# General configurations #
##########################

config :logger, level: :info

############################
# App configuration: arena #
############################

config :arena, ArenaWeb.Endpoint, cache_static_manifest: "priv/static/cache_manifest.json"

# Resolver los plugs del endpoint en RUNTIME (no en compile-time). Sin esto, el
# plug ArenaWeb.StaticAssets calcula sus rutas durante `mix release` (paths de
# /build) y las hornea; en el contenedor (/app) esos paths no existen y todo el
# tráfico estático cae al SPA. En dev Phoenix ya usa :runtime; aquí lo forzamos.
config :phoenix, :plug_init_mode, :runtime

###################################
# App configuration: game_backend #
###################################

# NOTA: la URL de la DB se configura en runtime.exs (se lee DATABASE_URL al
# arrancar). prod.exs es compile-time: si se pusiera aquí System.get_env, el
# valor se hornearía en la imagen y quedaría nil cuando el build no tiene la env.
config :game_backend, GameBackend.Repo,
  stacktrace: true,
  show_sensitive_data_on_connection_error: true,
  pool_size: 50
