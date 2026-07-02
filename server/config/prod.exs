import Config

##########################
# General configurations #
##########################

config :logger, level: :info

############################
# App configuration: arena #
############################

config :arena, ArenaWeb.Endpoint, cache_static_manifest: "priv/static/cache_manifest.json"

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
