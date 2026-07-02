# Invitar a un amigo a jugar (sin meterlo en tu tailnet)

Objetivo: que un amigo externo juegue por su navegador, **confinado al Corsair y
solo a los puertos del juego** — sin ver tus otras máquinas ni otros servicios.

## Paso 1 — Compartir SOLO el nodo Corsair (node sharing)
El amigo NO entra en tu tailnet; se le comparte una única máquina.

1. Admin console de Tailscale → **Machines** → `corsair` → menú `···` → **Share…**
2. Genera el enlace de invitación y envíaselo al amigo.
3. El amigo: se crea su cuenta de Tailscale (gratis), instala Tailscale, acepta el
   enlace. En **su** Tailscale aparece **solo** el Corsair.

Garantía: el amigo queda confinado al Corsair. No ve tu Mac ni tus EC2.

## Paso 2 — ACL: limitar al amigo a los puertos del juego (8080 + 7667)
Por defecto la ACL de Tailscale es "todo permitido" (`*`), lo que dejaría al amigo
alcanzar CUALQUIER puerto del Corsair (incl. SSH). Esto lo restringe al juego.

En Admin console → **Access controls**, deja la política así (ajusta el email):

```json
{
  "acls": [
    // Tus propios dispositivos (tú): acceso completo, sin cambios.
    { "action": "accept", "src": ["autogroup:member"], "dst": ["*:*"] },

    // El amigo: SOLO el Corsair, SOLO los puertos del juego.
    { "action": "accept", "src": ["EMAIL_DEL_AMIGO@ejemplo.com"], "dst": ["100.112.107.9:8080,7667"] }
  ]
}
```

Notas:
- `100.112.107.9` = IP Tailscale del Corsair (verifica con `tailscale status`).
- El cambio clave es que la regla "todo permitido" pase de `*` a `autogroup:member`,
  para que NO aplique a usuarios compartidos externos. Si no, el amigo heredaría el `*`.
- El editor de ACL valida la sintaxis antes de guardar.

## Paso 3 — El amigo juega
1. Abre en su navegador: `http://corsair.tailc48014.ts.net:8080/`
2. Se registra o usa una cuenta que le hayas creado (p. ej. `testraykor` / `soyunpaquete`).
3. Crea su personaje y a jugar.

## Recordatorio de seguridad
- El servidor corre **rootless en contenedor**: aunque el amigo fuese malicioso y
  explotara el juego, cae en un contenedor sin privilegios, sin acceso al host ni a
  tus otras máquinas ni a la base de datos directamente.
- Con la ACL del Paso 2, su única superficie es el juego (8080/7667).
