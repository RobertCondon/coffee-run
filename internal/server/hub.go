package server

import "sync"

// Hub sends a "something changed" ping to every open /api/events stream.
type Hub struct {
	lock        sync.Mutex
	subscribers map[chan int64]bool
}

func NewHub() *Hub {
	return &Hub{subscribers: map[chan int64]bool{}}
}

// Subscribe adds a new stream and returns the channel its pings arrive on.
func (hub *Hub) Subscribe() chan int64 {
	pings := make(chan int64, 1)
	hub.lock.Lock()
	hub.subscribers[pings] = true
	hub.lock.Unlock()
	return pings
}

// Unsubscribe removes a stream that has closed.
func (hub *Hub) Unsubscribe(pings chan int64) {
	hub.lock.Lock()
	delete(hub.subscribers, pings)
	hub.lock.Unlock()
}

// Publish never waits. If a stream already has a ping queued it skips that
// one: the phone pulls everything since its cursor anyway.
func (hub *Hub) Publish(version int64) {
	hub.lock.Lock()
	defer hub.lock.Unlock()
	for pings := range hub.subscribers {
		select {
		case pings <- version:
		default:
		}
	}
}
