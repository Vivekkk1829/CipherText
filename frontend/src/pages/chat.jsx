import { useOutletContext } from "react-router-dom";
export default function Chat(){
     const { user } = useOutletContext();
    return(
        <div>
            <h1>Welcome to chat</h1>
        </div>
    )
}