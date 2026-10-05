import { mount } from 'svelte';
import Overlay from './overlay/Overlay.svelte';

// Separate entry for the overlay window: no app state, no database, no sync.
export default mount(Overlay, { target: document.getElementById('app')! });
