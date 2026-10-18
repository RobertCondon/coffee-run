package server

type Hub struct{}

func NewHub() *Hub {
	return &Hub{}
}

func (h *Hub) Publish(version int64) {}
