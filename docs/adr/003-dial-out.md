# ADR-003: Host Agent dial-out

## Decision

Nodes **initiate** connections to Control Plane. Control Plane does not SSH/RDP or open bare remote shells.

## Why

Firewall-friendly; clearer auth; matches plan security model.

## Status

P1 uses local HTTP/WS on one machine. Multi-node mTLS is P6.
