use blake2::{Blake2s256, Digest};
use std::io::BufRead;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc, Mutex,
};
use std::thread;
use std::time::SystemTime;

const TARGET_HEX: &str = "00000000abc00000000000000000000000000000000000000000000000000000";

fn main() {
    let mut block_template = String::new();
    std::io::stdin()
        .lock()
        .read_line(&mut block_template)
        .expect("Failed to read block template from stdin");
    let block_template = block_template.trim().to_string();

    if block_template.is_empty() {
        eprintln!("[rust-miner] ERROR: received empty block template");
        std::process::exit(1);
    }

    let target = hex_to_bytes32(TARGET_HEX);

    let nonce_marker = "\"nonce\":\"";
    let marker_pos = block_template
        .find(nonce_marker)
        .expect("Block template must contain a \"nonce\":\" field");
    let nonce_value_pos = marker_pos + nonce_marker.len();

    let prefix_bytes: Arc<Vec<u8>> =
        Arc::new(block_template[..nonce_value_pos].as_bytes().to_vec());
    let suffix_bytes: Arc<Vec<u8>> =
        Arc::new(block_template[nonce_value_pos..].as_bytes().to_vec());

    let mut prefix_hasher = Blake2s256::new();
    Digest::update(&mut prefix_hasher, prefix_bytes.as_slice());
    let prefix_hasher: Arc<Blake2s256> = Arc::new(prefix_hasher);

    let target: Arc<[u8; 32]> = Arc::new(target);
    let found = Arc::new(AtomicBool::new(false));
    let result: Arc<Mutex<Option<Vec<u8>>>> = Arc::new(Mutex::new(None));

    let num_threads = thread::available_parallelism()
        .map(|n| n.get())
        .unwrap_or(4);
    eprintln!("[rust-miner] Mining with {} threads", num_threads);

    let mut handles = Vec::with_capacity(num_threads);

    for t in 0..num_threads {
        let prefix_bytes = Arc::clone(&prefix_bytes);
        let suffix_bytes = Arc::clone(&suffix_bytes);
        let prefix_hasher = Arc::clone(&prefix_hasher);
        let target = Arc::clone(&target);
        let found = Arc::clone(&found);
        let result = Arc::clone(&result);

        let start_counter: u64 = {
            let t_ns = SystemTime::now()
                .duration_since(SystemTime::UNIX_EPOCH)
                .unwrap_or_default()
                .as_nanos() as u64;
            t_ns.wrapping_mul(6364136223846793005)
                .wrapping_add(t as u64)
                .wrapping_mul(1442695040888963407)
                .wrapping_add(1013904223)
        };

        handles.push(thread::spawn(move || {
            let mut counter: u64 = start_counter;
            let mut nonce_buf = [b'0'; 64];

            loop {
                if found.load(Ordering::Relaxed) {
                    return;
                }

                write_nonce_hex(counter, &mut nonce_buf);

                let mut h: Blake2s256 = (*prefix_hasher).clone();
                Digest::update(&mut h, &nonce_buf as &[u8]);
                Digest::update(&mut h, suffix_bytes.as_slice());
                let hash = h.finalize();

                if le256(hash.as_ref(), target.as_ref()) {
                    if !found.swap(true, Ordering::AcqRel) {
                        let mut block =
                            Vec::with_capacity(prefix_bytes.len() + 64 + suffix_bytes.len());
                        block.extend_from_slice(&prefix_bytes);
                        block.extend_from_slice(&nonce_buf);
                        block.extend_from_slice(&suffix_bytes);
                        *result.lock().unwrap() = Some(block);
                    }
                    return;
                }

                counter = counter.wrapping_add(1);
            }
        }));
    }

    for h in handles {
        h.join().expect("Worker thread panicked");
    }

    let found_block = result.lock().unwrap().take();
    match found_block {
        Some(bytes) => {
            let block = String::from_utf8(bytes).expect("Block is not valid UTF-8");
            println!("{}", block);
        }
        None => {
            eprintln!("[rust-miner] No block found (killed externally?)");
            std::process::exit(1);
        }
    }
}

#[inline]
fn write_nonce_hex(val: u64, buf: &mut [u8; 64]) {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    buf[..48].fill(b'0');
    for i in 0..16 {
        buf[63 - i] = HEX[((val >> (i * 4)) & 0xf) as usize];
    }
}

fn hex_to_bytes32(s: &str) -> [u8; 32] {
    assert_eq!(s.len(), 64, "expected 64 hex chars");
    let mut out = [0u8; 32];
    for i in 0..32 {
        out[i] = u8::from_str_radix(&s[2 * i..2 * i + 2], 16)
            .expect("invalid hex in target");
    }
    out
}

#[inline]
fn le256(a: &[u8], b: &[u8]) -> bool {
    for i in 0..32 {
        match a[i].cmp(&b[i]) {
            std::cmp::Ordering::Less => return true,
            std::cmp::Ordering::Greater => return false,
            std::cmp::Ordering::Equal => continue,
        }
    }
    true
}
