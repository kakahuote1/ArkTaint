import request from "@ohos.request";

export function request_uploadfile_context_002_F(userInput: string): void {
    const uploadConfig = {
        url: "https://upload.example.com/object",
        method: "PUT",
        files: [
            {
                filename: "avatar.jpg",
                name: "file",
                uri: "internal://cache/avatar.jpg",
                type: "image/jpeg"
            }
        ]
    };
    request.uploadFile(userInput, uploadConfig);
}
